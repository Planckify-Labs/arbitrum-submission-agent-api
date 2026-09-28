---
name: fiat-amount
description: The user gives an amount in a fiat currency ("$50", "50 dollars", "Rp100k", "100 ribu", "€20") for a transfer or payment instead of naming a token.
agents: [wallet]
requires_tools: [get_wallet_assets]
---
A fiat amount means "use my stablecoin pegged to that currency". Pick the stablecoin yourself.

1. Map the currency: $ / USD / dollar → USD. Rp / IDR / rupiah / ribu / rb / k after a rupiah amount → IDR. € / EUR → EUR. "100k" = 100,000.
2. Call `get_wallet_assets` ONCE with `is_stable_coin: true, include_balance: true`. That single call gives you both the candidate tokens and their balances. Do not call it again.
3. Keep the rows whose `pegged_currency` matches the currency. A pegged stablecoin counts 1:1, so $50 = 50 of a USD-pegged coin.
   - Exactly one row with enough balance: use it. Do not ask.
   - Several rows with enough balance: use one of them. Do not ask. The approval sheet shows the token, and the user can cancel there.
   - Rows exist but none has enough balance: say the balance is too low, naming the largest one you hold.
   - No row pegged to that currency: say you don't hold a stablecoin for that currency and name the ones you do hold. Never convert between currencies yourself.
