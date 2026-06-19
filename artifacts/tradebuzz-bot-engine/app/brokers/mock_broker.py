import random
import uuid
from datetime import datetime
from typing import Optional
from app.brokers.base import (
    BrokerConnector,
    AccountBalance,
    MarketPrice,
    OrderResult,
    OpenPosition,
)

MOCK_PRICES = {
    "BTC/USD": 68000.0,
    "ETH/USD": 3800.0,
    "AAPL": 195.0,
    "TSLA": 250.0,
    "EUR/USD": 1.085,
    "GBP/USD": 1.265,
    "XRP/USD": 0.62,
    "SOL/USD": 170.0,
}


class MockBrokerConnector(BrokerConnector):
    """
    Mock broker for paper trading and testing.
    Simulates realistic price movements and order execution.
    """

    def __init__(self, initial_balance: float = 10000.0):
        self._balance = initial_balance
        self._connected = False
        self._positions: dict[str, OpenPosition] = {}
        self._prices = dict(MOCK_PRICES)

    def connect(self) -> bool:
        self._connected = True
        return True

    def get_account_balance(self) -> AccountBalance:
        return AccountBalance(
            total=self._balance,
            available=self._balance,
            currency="USD",
        )

    def get_open_positions(self) -> list[OpenPosition]:
        return list(self._positions.values())

    def get_market_price(self, symbol: str) -> MarketPrice:
        base_price = self._prices.get(symbol, 100.0)
        drift = random.uniform(-0.002, 0.002)
        last = base_price * (1 + drift)
        self._prices[symbol] = last
        spread = last * 0.0002
        return MarketPrice(
            symbol=symbol,
            bid=last - spread,
            ask=last + spread,
            last=last,
            timestamp=datetime.utcnow().isoformat(),
        )

    def place_order(
        self,
        symbol: str,
        direction: str,
        quantity: float,
        order_type: str = "MARKET",
        price: Optional[float] = None,
        stop_loss: Optional[float] = None,
        take_profit: Optional[float] = None,
    ) -> OrderResult:
        market_price = self.get_market_price(symbol)
        fill_price = market_price.ask if direction == "BUY" else market_price.bid
        order_id = str(uuid.uuid4())[:8]

        position_id = f"pos_{order_id}"
        self._positions[position_id] = OpenPosition(
            symbol=symbol,
            direction=direction,
            quantity=quantity,
            entry_price=fill_price,
            current_price=fill_price,
            unrealised_pnl=0.0,
            position_id=position_id,
        )

        cost = fill_price * quantity
        if direction == "BUY":
            self._balance -= cost
        else:
            self._balance += cost

        return OrderResult(
            order_id=order_id,
            status="FILLED",
            symbol=symbol,
            direction=direction,
            quantity=quantity,
            price=fill_price,
        )

    def close_position(self, position_id: str, symbol: str) -> OrderResult:
        position = self._positions.pop(position_id, None)
        if not position:
            return OrderResult(
                order_id="",
                status="ERROR",
                symbol=symbol,
                direction="CLOSE",
                quantity=0,
                price=0,
                error=f"Position {position_id} not found",
            )

        market_price = self.get_market_price(symbol)
        close_price = market_price.bid if position.direction == "BUY" else market_price.ask
        pnl = (close_price - position.entry_price) * position.quantity
        if position.direction == "SELL":
            pnl = -pnl

        self._balance += (close_price * position.quantity) + pnl
        order_id = str(uuid.uuid4())[:8]

        return OrderResult(
            order_id=order_id,
            status="CLOSED",
            symbol=symbol,
            direction="CLOSE",
            quantity=position.quantity,
            price=close_price,
        )

    def cancel_order(self, order_id: str) -> bool:
        return True

    def is_market_open(self, symbol: str) -> bool:
        return True
