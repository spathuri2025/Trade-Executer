"""
Paper Trading Engine.

Simulates trade execution using mock/live market prices.
Tracks virtual balance, positions, and P&L without risking real money.
"""
from datetime import datetime
from sqlalchemy.orm import Session
from app.brokers.base import BrokerConnector
from app.models import Trade, Order, Position, BotSettings
from app.logs import log_event


class PaperTradingEngine:
    def __init__(self, db: Session, broker: BrokerConnector):
        self.db = db
        self.broker = broker

    def open_trade(
        self,
        user_id: int,
        strategy_id: int | None,
        signal_id: int | None,
        symbol: str,
        market: str,
        direction: str,
        stop_loss: float | None,
        take_profit: float | None,
        quantity: float = 0.01,
    ) -> Trade:
        price_data = self.broker.get_market_price(symbol)
        entry_price = price_data.ask if direction == "BUY" else price_data.bid

        trade = Trade(
            user_id=user_id,
            strategy_id=strategy_id,
            signal_id=signal_id,
            symbol=symbol,
            market=market,
            direction=direction,
            mode="PAPER",
            entry_price=entry_price,
            quantity=quantity,
            stop_loss=stop_loss,
            take_profit=take_profit,
            pnl=0.0,
            status="OPEN",
            is_paper=True,
        )
        self.db.add(trade)
        self.db.flush()

        order = Order(
            trade_id=trade.id,
            symbol=symbol,
            order_type="MARKET",
            direction=direction,
            quantity=quantity,
            price=entry_price,
            status="FILLED",
            mode="PAPER",
        )
        self.db.add(order)

        position = Position(
            trade_id=trade.id,
            user_id=user_id,
            symbol=symbol,
            direction=direction,
            quantity=quantity,
            entry_price=entry_price,
            current_price=entry_price,
            unrealised_pnl=0.0,
            is_open=True,
            is_paper=True,
        )
        self.db.add(position)
        self.db.commit()

        log_event(
            self.db,
            "INFO",
            "PAPER_TRADE_OPENED",
            f"Paper trade opened: {direction} {quantity} {symbol} @ {entry_price:.4f}",
            symbol=symbol,
        )

        self._update_virtual_balance(user_id, -(entry_price * quantity) if direction == "BUY" else 0)
        return trade

    def close_trade(self, trade_id: int, user_id: int) -> Trade:
        trade = self.db.query(Trade).filter(Trade.id == trade_id, Trade.status == "OPEN").first()
        if not trade:
            raise ValueError(f"Open trade {trade_id} not found")

        price_data = self.broker.get_market_price(trade.symbol)
        close_price = price_data.bid if trade.direction == "BUY" else price_data.ask

        if trade.direction == "BUY":
            pnl = (close_price - trade.entry_price) * trade.quantity
        else:
            pnl = (trade.entry_price - close_price) * trade.quantity

        pnl_pct = (pnl / (trade.entry_price * trade.quantity)) * 100 if trade.entry_price else 0

        trade.exit_price = close_price
        trade.pnl = round(pnl, 6)
        trade.pnl_pct = round(pnl_pct, 4)
        trade.status = "CLOSED"
        trade.closed_at = datetime.utcnow()

        position = self.db.query(Position).filter(Position.trade_id == trade_id, Position.is_open == True).first()
        if position:
            position.current_price = close_price
            position.unrealised_pnl = 0.0
            position.is_open = False

        order = Order(
            trade_id=trade.id,
            symbol=trade.symbol,
            order_type="MARKET",
            direction="CLOSE",
            quantity=trade.quantity,
            price=close_price,
            status="FILLED",
            mode="PAPER",
        )
        self.db.add(order)
        self.db.commit()

        self._update_virtual_balance(user_id, (close_price * trade.quantity) + pnl)

        log_event(
            self.db,
            "INFO",
            "PAPER_TRADE_CLOSED",
            f"Paper trade closed: {trade.direction} {trade.symbol} @ {close_price:.4f} | PnL={pnl:.4f} ({pnl_pct:.2f}%)",
            symbol=trade.symbol,
            extra={"pnl": pnl, "pnl_pct": pnl_pct},
        )
        return trade

    def _update_virtual_balance(self, user_id: int, delta: float) -> None:
        bot = self.db.query(BotSettings).filter(BotSettings.user_id == user_id).first()
        if bot:
            bot.virtual_balance = round(bot.virtual_balance + delta, 4)
            self.db.commit()

    def update_open_positions(self, user_id: int) -> None:
        """Refresh unrealised P&L for all open paper positions."""
        open_positions = self.db.query(Position).filter(
            Position.user_id == user_id, Position.is_open == True, Position.is_paper == True
        ).all()
        for pos in open_positions:
            try:
                price_data = self.broker.get_market_price(pos.symbol)
                pos.current_price = price_data.last
                if pos.direction == "BUY":
                    pos.unrealised_pnl = (price_data.last - pos.entry_price) * pos.quantity
                else:
                    pos.unrealised_pnl = (pos.entry_price - price_data.last) * pos.quantity
            except Exception:
                pass
        self.db.commit()
