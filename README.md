# SALGA Digital Mart — Production Marketplace

## Production payments
Set these Netlify environment variables:
- PAYSTACK_SECRET_KEY = your LIVE Paystack secret key
- ADMIN_EMAIL = your admin email
- ADMIN_PASSWORD = a strong admin password

The code initializes and verifies real Paystack transactions. Seller bank details are intended to be connected as Paystack subaccounts so Paystack can settle the seller while the marketplace keeps its platform charge.

### Commission model
- Standard marketplace commission: 5% of each paid transaction.
- Promotion service: additional 2% of the value of transactions attributed to promoted products.
- Therefore a promoted sale has a 7% SALGA platform charge; a normal sale has 5%.
- Paystack's own gateway fees are separate and are handled according to the Paystack split configuration.

Paystack supports marketplace split payments through subaccounts and transaction charges. See official docs:
https://paystack.com/docs/payments/split-payments/
https://paystack.com/docs/api/transaction/

## Seller account
The production version requires:
- business name
- phone
- password
- bank name
- bank account number

For actual automatic settlement, seller bank accounts must be created/verified as Paystack subaccounts. The current scaffold stores the bank details but expects `subaccountCode` to be populated after the Paystack subaccount creation flow is connected.

## SMS/WhatsApp activation
The account API returns an activation code so the account can be activated during development. To make delivery fully automatic, connect an SMS/WhatsApp provider and implement the provider call in `auth.mjs`; do not put provider secrets in browser code.

## Security
Change the default admin credentials through Netlify environment variables before production use. Do not commit live API keys into the repository.
