from abc import ABC, abstractmethod
from dataclasses import dataclass
from enum import Enum
from typing import Optional


class SignalType(str, Enum):
    BUY = "BUY"
    SELL = "SELL"
    HOLD = "HOLD"


@dataclass
class StrategySignal:
    signal: SignalType
    confidence: float
    reasoning: str
    symbol: str
    timeframe: str
    stop_loss: Optional[float] = None
    take_profit: Optional[float] = None


class BaseStrategy(ABC):
    """Abstract base for all trading strategies."""

    name: str = "BaseStrategy"
    description: str = ""

    def __init__(self, symbol: str, timeframe: str, parameters: dict):
        self.symbol = symbol
        self.timeframe = timeframe
        self.parameters = parameters

    @abstractmethod
    def generate_signal(self, prices: list[float], **kwargs) -> StrategySignal:
        """
        Given a list of recent closing prices (oldest first), return a signal.
        Subclasses implement the actual strategy logic here.
        """
        pass

    def validate_parameters(self) -> bool:
        return True
