# TradeBuzz — User Guide

A plain-language guide to using TradeBuzz. No trading or technical background needed.

## What is TradeBuzz?

TradeBuzz is an automated trading assistant. You connect your own broker account
(Capital.com or Trading 212), tell TradeBuzz which markets to watch and how
cautious to be, and it can automatically buy and sell for you based on rules —
no manual trading required, though you can also just watch and learn without
letting it trade.

It never uses guesswork or "AI intuition" to decide when to buy or sell — every
buy/sell decision comes from fixed, testable maths (explained in
[How TradeBuzz Decides When to Trade](#how-tradebuzz-decides-when-to-trade)
below). The AI features are for explaining things to you in plain English, not
for making trading calls.

**Important:** trading involves real risk. TradeBuzz gives you tools and
automation, not guarantees. Only trade with money you can afford to lose, and
use a demo/practice broker account first if you're new to this.

---

## Getting Started

### 1. Create your account
Sign up with your email and a password.

### 2. Setup Wizard
The first time you log in, you'll be walked through a **Setup Wizard**. It
will ask you to:
- **Connect your broker** — enter your Capital.com or Trading 212 login
  details so TradeBuzz can see your account and place trades on your behalf.
  Your details are stored encrypted; TradeBuzz never shows your broker
  password back to you or anyone else.
- **Pick your instruments** — choose which shares, indices, or markets you
  want TradeBuzz to watch.
- **Set your basic preferences** — how much to risk per trade, and how
  cautious the bot should be.

You can change any of this later in **Settings**.

### 3. You're in
Once setup is done, you land on the **Dashboard** — your home screen.

---

## The Dashboard

This is your control centre. It shows:
- **Account summary** — your cash, how much is currently invested, your
  profit/loss, and your total account value.
- **Live prices** — a scrolling ticker of the markets you're watching, updated
  in real time (or showing "Market closed" outside trading hours).
- **Bot status** — a simple Start/Stop switch. When it's running, TradeBuzz is
  actively watching your chosen markets and will trade automatically according
  to your settings. When it's stopped, nothing happens until you switch it
  back on.
- **Recent activity** — a feed of what the bot has just done or noticed.

If any open position's size is larger than your configured **Max Position
Size**, a yellow warning banner appears at the top of the Dashboard telling
you which position and by how much. This is purely informational — TradeBuzz
will never close a position automatically because of this warning — but it's
worth reviewing with your broker, since it usually means a position was
opened before you set that limit (or outside TradeBuzz entirely).

## Instruments

This page lists every market TradeBuzz can trade for you (e.g. shares like
Apple, or indices). Turn instruments on or off here — only instruments you've
switched **on** get watched and traded.

## Charts

A simple price chart for any instrument you're watching, so you can see for
yourself what the market has been doing recently.

## Settings

This is where you fine-tune how TradeBuzz behaves:
- **Timeframe (bar resolution)** — how often TradeBuzz checks prices and makes
  decisions (e.g. every 5 minutes). Shorter = more frequent, faster-moving
  trades. Longer = slower, steadier.
- **Position sizing** — how much money to put into each trade.
- **Stop loss / take profit** — automatic safety nets. A stop loss
  automatically closes a losing trade before it gets too costly; a take profit
  automatically locks in a win once a target is hit.
- **Regime filter** — an optional setting that lets TradeBuzz pick between two
  different strategies depending on whether a market currently looks like
  it's trending or going sideways (see below).
- **End-of-day close (flatten-by-close)** — when switched on, TradeBuzz
  automatically closes out any open positions before that market shuts for
  the day, so you never accidentally hold something overnight.

## How TradeBuzz Decides When to Trade

TradeBuzz currently runs on two live strategies — simple, well-known trading
rules, not opinions:
- **Trend-following** — buys when a market's short-term average price rises
  above its longer-term average (a classic sign a trend may be starting), and
  sells on the reverse.
- **Mean-reversion** — looks for a market that has swung unusually far from
  its normal range and bets it will drift back toward normal.

If you turn on the **regime filter**, TradeBuzz automatically switches between
these two depending on what the market is currently doing — trend-following
when a market is trending, mean-reversion when it's going sideways.

A third strategy, **ATR Momentum**, is currently available to *test* on the
Performance page (see below) but is not yet used for live trading — think of
it as "in the lab."

TradeBuzz will never place a *new* trade while a market shows as closed or
untradeable. It never blocks closing an existing trade for this reason,
though — if you're already in a trade, TradeBuzz can still exit it even
while the market shows as untradeable.

## Scanner

Instead of watching only the instruments you picked, the Scanner searches
across a much wider range of markets in real time, looking for ones that
currently match TradeBuzz's buy/sell rules. Use it to discover opportunities
you might not have thought to add yourself.

## Signals

A running log of every buy/sell signal TradeBuzz's strategies have spotted,
whether or not a trade was actually placed. Useful for seeing the bot's
reasoning trail over time.

## Trades

Your full trade history — everything TradeBuzz has actually bought or sold on
your behalf, with the result of each one.

## Performance

This is where you can **test a strategy before trusting it** — a "dry run"
using real recent market data, without risking any money.

For each instrument you're watching, you'll see up to three result cards (one
per strategy): **Trend-following**, **Mean-reversion**, and **ATR Momentum**.
Each card shows things like:
- **Win rate** — what fraction of past trades would have been profitable.
- **Total return** — how much a starting balance would have grown or shrunk.
- **Biggest drawdown** — the worst dip you'd have experienced along the way.
- **Cost** — an estimate of real trading costs (spread), so the numbers aren't
  unrealistically rosy.

A strategy that looks good here isn't a promise of future profit — markets
change — but it's a much better starting point than guessing.

If a card shows a yellow **"too few trades"** note, its result is based on a
small number of trades and shouldn't be trusted yet — win rate and other
numbers can look unusually good or bad purely by chance on a small sample,
and can flip the next time you re-run the backtest. Give more weight to
cards with a larger trade count, and treat any single backtest run as a
first look, not a final verdict — re-running it periodically and checking
for consistency matters more than any one result.

*Note: the ATR Momentum card won't appear for Trading 212 accounts — that
broker doesn't provide the detailed price data this strategy needs. You'll
still see Trend-following and Mean-reversion results for those accounts.*

## Market News

A feed of relevant market headlines, to help you understand *why* a market
might be moving.

## Assistant

Your daily briefing and a chat window. Each day, the Assistant summarises your
account, positions, and anything noteworthy in plain English. You can also
just ask it questions — e.g. "how did I do this week?" — and it will answer
using your actual account data. It explains things; it doesn't decide trades.

## Signal Analyst

A second AI-powered chat, focused specifically on reviewing the trading
signals and trades TradeBuzz has made — good for asking "why did it do that?"
about a specific trade or signal.

---

## Frequently Asked Questions

**Will TradeBuzz trade with money I haven't approved?**
No. It only ever trades within the broker account you connected, using the
position-sizing and instrument settings you've chosen. You can stop it
instantly from the Dashboard at any time.

**What happens if I stop the bot while I have open positions?**
Stopping the bot only stops it from looking for *new* trades — it does not
automatically close positions you already hold. Close those manually through
your broker if needed, or leave them open if you're happy to hold them.

**Why does a market show "Market closed" or a dash instead of a price?**
Some markets (e.g. US shares) only trade during their local exchange hours.
Outside those hours, TradeBuzz shows "Market closed" instead of a live price,
and won't open new trades on that market until it's open again.

**My account numbers don't seem to add up — is something wrong?**
Your **Deposited Funds** + **Profit/Loss** should always equal your
**Total** account value. The separate **Cash** figure is your broker's
available margin, which is a different number and isn't meant to be added
into that total.

**Can I use TradeBuzz without letting it trade automatically?**
Yes — leave the bot switched off on the Dashboard and just use the Scanner,
Performance, and Assistant pages to research markets. Nothing trades until
you turn the bot on.

**Why is there a yellow warning banner about my position size on the Dashboard?**
It means one of your open positions is larger than your configured Max
Position Size setting — most often because it was opened before that limit
was set, or opened outside TradeBuzz altogether. TradeBuzz won't close it for
you; review it with your broker and decide whether to reduce it yourself.

**Why does a Performance card say "too few trades"?**
Backtests are only as trustworthy as the number of trades behind them. A
result built on just a handful of trades can look extremely good or bad by
pure chance, and can flip completely the next time you re-run it. This label
is a reminder not to treat a small sample as a proven edge — look for
consistency across multiple runs and larger trade counts instead.

**I'm still seeing an old value or a page that doesn't match this guide — what's wrong?**
TradeBuzz occasionally ships updates. If a page looks out of date right after
an update, do a hard refresh of your browser (Ctrl+Shift+R on Windows,
Cmd+Shift+R on Mac) or open the page in a new tab — a browser tab left open
from before an update can keep running the old version until it's reloaded.
