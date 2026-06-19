from abc import ABC, abstractmethod
from typing import Optional
from dataclasses import dataclass


@dataclass
class AccountBalance:
    total: float
    available: float
    currency: str = "USD"


@dataclass
class MarketPrice:
    symbol: str
    bid: float
    ask: float
    last: float
    timestamp: str


@dataclass
class OrderResult:
    order_id: str
    status: str
    symbol: str
    direction: str
    quantity: float
    price: float
    error: Optional[str] = None


@dataclass
class OpenPosition:
    symbol: str
    direction: str
    quantity: float
    entry_price: float
    current_price: float
    unrealised_pnl: float
    position_id: str


class BrokerConnector(ABC):
    """Abstract base class for all broker connectors."""

    @abstractmethod
    def connect(self) -> bool:
        """Connect to the broker API. Returns True if successful."""
        pass

    @abstractmethod
    def get_account_balance(self) -> AccountBalance:
        """Fetch current account balance."""
        pass

    @abstractmethod
    def get_open_positions(self) -> list[OpenPosition]:
        """Fetch all currently open positions."""
        pass

    @abstractmethod
    def get_market_price(self, symbol: str) -> MarketPrice:
        """Fetch the current market price for a symbol."""
        pass

    @abstractmethod
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
        """Place a new order."""
        pass

    @abstractmethod
    def close_position(self, position_id: str, symbol: str) -> OrderResult:
        """Close an open position."""
        pass

    @abstractmethod
    def cancel_order(self, order_id: str) -> bool:
        """Cancel a pending order."""
        pass

    @abstractmethod
    def is_market_open(self, symbol: str) -> bool:
        """Check whether the market for a symbol is currently open."""
        pass
