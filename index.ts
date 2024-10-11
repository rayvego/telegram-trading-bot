import { Bot, InlineKeyboard } from "grammy";
import {BOT_TOKEN, solEndpoint} from "./config.ts";
import axios from "axios";
import {Connection, Keypair, PublicKey, SystemProgram, Transaction, VersionedTransaction} from "@solana/web3.js";

//Create a new bot
const bot = new Bot(BOT_TOKEN);

const userWallets: { [userId: number]: Keypair } = {};
const userQuotes: { [userId: number]: any } = {};

const tokenMints = {
	["sol"]: "So11111111111111111111111111111111111111112",
	["usdc"]: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
	["usdt"]: "Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB",
}

// * START COMMAND
bot.command("start", async (ctx) => {
	const userId = ctx.from!.id;

	if (userWallets[userId]) {
		await ctx.reply("You already have a wallet! Your public key is: " + userWallets[userId].publicKey.toBase58());
		return;
	}

	const wallet = Keypair.generate();

	userWallets[userId] = wallet;

	await ctx.reply(
		`🎉 Welcome to RayBot\\. Your new wallet has been created\\.\n\n` +
		`📜 *Here\\'s how you can use RayBot:*\n\n` +
		`1\\. **\\/start** \\- Creates a new wallet for you\\. You\\'ll only need to use this once\\.\n` +
		`2\\. **\\/price \\[TOKEN\\]** \\- Get the current price of a token\\. Example: \`\\/price sol\`\\.\n` +
		`3\\. **\\/balance** \\- Check the balance of your wallet\\.\n` +
		`4\\. **\\/send \\[RECIPIENT\\] \\[AMOUNT\\]** \\- Send SOL to another wallet\\. Example: \`\\/send <recipient\\_public\\_key> 1\\.5\`\\.\n` +
		`5\\. **\\/swap \\[AMOUNT\\] \\[FROM\\_TOKEN\\] \\[TO\\_TOKEN\\]** \\- Swap tokens using the Jupiter liquidity aggregator\\. Example: \`\\/swap 10 sol usdc\`\\.\n\n` +
		`💡 For token swaps, we currently support: SOL, USDC, and USDT\\.\n\n` +
		`💳 *Your Wallet Details:*\n` +
		`Public Key: \`${wallet.publicKey.toBase58()}\`\n\n` +
		`Feel free to start using these commands anytime\\!`
		, {
			parse_mode: "MarkdownV2",
		});


})

// * PRICE COMMAND
bot.command("price", async (ctx) => {
	const messageText = ctx.message!.text;
	const parts = messageText.split(" ");

	if (parts.length !== 2) {
		await ctx.reply("Please provide a symbol. Example: /price SOL");
		return
	}

	const symbol = parts[1].toUpperCase();

	await ctx.reply(`Getting the current price of ${symbol}...`);

	const res = await axios.get(`https://price.jup.ag/v6/price?ids=${symbol}`)

	const price = res.data.data[symbol].price;
	console.log(price)

	await ctx.reply(`The current price of ${symbol} is: ${res.data.data[symbol].price} USDC!`);
})

// * BALANCE COMMAND
bot.command("balance", async (ctx) => {
	const userId = ctx.from!.id;

	if (!userWallets[userId]) {
		await ctx.reply("You don't have a wallet yet! Create one by using the /start command.");
		return;
	}

	const wallet = userWallets[userId];

	await ctx.reply("Getting your balance...");

	const res = await axios.post(solEndpoint, {
		jsonrpc: "2.0",
		id: 1,
		method: "getBalance",
		params: [wallet.publicKey.toBase58()],
	});

	console.log(res.data.result.value / 1_000_000_000)

	await ctx.reply(`Your balance is: ${res.data.result.value / 1_000_000_000} SOL!`);
})

// * SEND COMMAND
bot.command("send", async (ctx) => {
	const userId = ctx.from!.id;

	if (!userWallets[userId]) {
		await ctx.reply("You don't have a wallet yet! Create one by using the /start command.");
		return;
	}

	const wallet = userWallets[userId];

	const messageText = ctx.message!.text;
	const parts = messageText.split(" ");

	if (parts.length !== 3) {
		await ctx.reply("Please provide a recipient and an amount. Example: /send <recipient> <amount>");
		return
	}

	const connection = new Connection(solEndpoint, "confirmed");

	const recipient = parts[1];
	const amount = parts[2];

	await ctx.reply(`Sending ${amount} SOL to ${recipient}...`);

	const transaction = new Transaction().add(
		SystemProgram.transfer({
			fromPubkey: wallet.publicKey,
			toPubkey: new PublicKey(recipient),
			lamports: parseFloat(amount) * 1_000_000_000,
		})
	);

	transaction.feePayer = wallet.publicKey;
	transaction.recentBlockhash = (await connection.getLatestBlockhash()).blockhash;
	transaction.sign(wallet);

	const serializedTransaction = transaction.serialize();
	try {
		const txId = await connection.sendRawTransaction(serializedTransaction);
		console.log("Transaction sent successfully. Txn ID:", txId);
		await ctx.reply(`Transaction submitted successfully. Txn ID: ${txId}`);
		return txId;
	} catch (error) {
		console.error("Failed to send transaction:", error);
		await ctx.reply(`Failed to send transaction: ${error}`);
	}
})

// * SWAP COMMAND
bot.command("swap", async (ctx) => {
	const userId = ctx.from!.id;

	if (!userWallets[userId]) {
		await ctx.reply("You don't have a wallet yet! Create one by using the /start command.");
		return;
	}

	const input = ctx.message!.text.split(" ");
	if (input.length === 4) {
		const [_, amount, fromToken, toToken] = input;

		const quote = await getSwapQuote(tokenMints[fromToken], tokenMints[toToken], parseFloat(amount) * 1_000_000_000, userId);

		if (quote) {
			const { outAmount, feeAmount, mm, slippage } = quote;

			await ctx.reply(
				`💱 <b>Swap Details</b>\n\n` +
				`<b>From:</b> ${amount} ${fromToken.toUpperCase()}\n` +
				`<b>To:</b> ${outAmount / 1_000_000} ${toToken.toUpperCase()}\n` +
				`<b>Slippage:</b> ${slippage}%\n` +
				`<b>Fees:</b> ${feeAmount / 1_000_000_000} SOL\n` +
				`<b>Market Maker:</b> ${mm}\n\n` +
				`Would you like to proceed with this swap?`,
				{
					parse_mode: "HTML",
					reply_markup: new InlineKeyboard()
						.text("Confirm", "confirm_swap")
						.text("Cancel", "cancel_swap"),
				}
			);
		} else {
			await ctx.reply("⚠️ Unable to fetch quote. Please try again.");
		}
	} else {
		await ctx.reply("Invalid input! Please use the format: `/swap <amount> <from_token> <to_token>`.");
	}
});

// * CONFIRM SWAP
bot.callbackQuery("confirm_swap", async (ctx) => {
	const userId = ctx.from!.id;

	if (!userQuotes[userId]) {
		await ctx.reply("No swap quote found. Please start the swap process again.");
		return;
	}

	try {
		const quote = userQuotes[userId]; // Retrieve stored quote
		const swapResult = await performSwap(quote, userId); // Pass the quote and user ID to performSwap

		if (swapResult.success) {
			await ctx.reply(`✅ Swap successful! Transaction ID: ${swapResult.txId}`);
		} else {
			await ctx.reply("⚠️ Swap failed. Please try again later.");
		}
	} catch (error) {
		console.error(error);
		await ctx.reply("⚠️ An error occurred while processing the swap.");
	}
});

// * CANCEL SWAP
bot.callbackQuery("cancel_swap", async (ctx) => {
	await ctx.reply("❌ Swap cancelled.");
});

// * GET SWAP QUOTE FUNCTION
async function getSwapQuote(fromToken: string, toToken: string, amount: number, userId: number) {
	try {
		const response = await axios.get(
			`https://quote-api.jup.ag/v6/quote?inputMint=${fromToken}&outputMint=${toToken}&amount=${amount}`
		);

		if (response.data) {
			userQuotes[userId] = response.data;
			console.log(response.data)

			const quote = response.data.routePlan[0].swapInfo;
			return {
				outAmount: quote.outAmount,
				feeAmount: quote.feeAmount,
				mm: quote.label,
				slippage: response.data.slippageBps
			};
		}
	} catch (error) {
		console.error("Error fetching swap quote:", error);
		return null;
	}
}

// * PERFORM SWAP FUNCTION
async function performSwap(quoteResponse: string, userId: number) {
	const wallet = userWallets[userId];

	if (!wallet) {
		throw new Error("User wallet not found");
	}

	const connection = new Connection(solEndpoint, "confirmed");

	try {
		const { swapTransaction } = await (
			await fetch('https://quote-api.jup.ag/v6/swap', {
				method: 'POST',
				headers: {
					'Content-Type': 'application/json'
				},
				body: JSON.stringify({
					// quoteResponse from /quote api
					quoteResponse,
					// user public key to be used for the swap
					userPublicKey: wallet.publicKey.toString(),
					// auto wrap and unwrap SOL. default is true
					wrapAndUnwrapSol: true,
					// feeAccount is optional. Use if you want to charge a fee.  feeBps must have been passed in /quote API.
					// feeAccount: "fee_account_public_key"
				})
			})
		).json();

		// console.log("==================================================================================================");
		// console.log("==================================================================================================");
		// console.log(quoteResponse)
		// console.log(swapTransaction);

		const swapTransactionBuf = Buffer.from(swapTransaction, 'base64');
		var transaction = VersionedTransaction.deserialize(swapTransactionBuf);
		console.log(transaction);

		transaction.sign([wallet]);

		const latestBlockHash = await connection.getLatestBlockhash();

		const rawTransaction = transaction.serialize()
		const txid = await connection.sendRawTransaction(rawTransaction, {
			skipPreflight: true,
			maxRetries: 2
		});
		await connection.confirmTransaction({
			blockhash: latestBlockHash.blockhash,
			lastValidBlockHeight: latestBlockHash.lastValidBlockHeight,
			signature: txid
		});
		console.log(`https://solscan.io/tx/${txid}`);
	} catch (error) {
		console.error("Error performing swap:", error);
		return { success: false };
	}
}

//Start the Bot
bot.start();