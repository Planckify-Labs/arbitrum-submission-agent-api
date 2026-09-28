---
name: pay-a-person
description: The user wants to send money or a token to someone they name or describe instead of pasting an address ("send $50 to mom", "pay Budi 100k", "transfer 10 USDC to my landlord").
agents: [wallet]
requires_tools: [search_address_book, get_address_book, get_wallet_assets, send_token, send_native]
---
Do every lookup yourself, in this order, before you say anything. Never ask the user whether someone is saved in the address book: check it.

1. **Recipient.**
   - A relationship word ("mom", "ibu", "my brother", "kakak"): call `get_address_book` and find the person yourself. People save family under any label or language: mom = mother = mama = ibu = bunda = mami; dad = father = papa = ayah = bapak; brother/sister = kakak = adik.
   - A name ("Budi", "Alice"): call `search_address_book` with `query` set to that name. If it returns nothing, call `get_address_book` once before concluding they aren't saved.
   - Exactly one contact whose address fits the active chain: that is the recipient. Do not ask the user to confirm it. The approval sheet shows the recipient.
   - Several plausible contacts: ask ONE question naming them by label.
   - None: say you couldn't find them in the address book and ask for their address. This is the only case where you ask for an address.
2. **Token and amount.**
   - A fiat amount ("$50", "Rp100k", "50 dollars"): follow the fiat-amount skill.
   - A token symbol ("10 USDC", "AUSD"): call `get_wallet_assets` with that `symbol` and `include_balance: true`.
   - No token and no currency at all ("send mom 20"): call `get_wallet_assets` with `include_balance: true`. If the wallet holds exactly one asset with enough balance, use it. Otherwise ask which one, naming the options you found.
   - Treat an obvious typo of a symbol or verb ("sand AUSD", "usdcc") as the thing it plainly means.
3. **Send.** Native coin: `send_native { to, amount }`. Any other asset: `send_token { to, symbol, amount }`. The approval sheet is the confirmation. Do not ask "are you sure?".

Stop and explain in one sentence, instead of sending, only if the balance is too low or the contact's address is for a different chain than the active one.
