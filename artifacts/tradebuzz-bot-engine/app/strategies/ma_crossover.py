"""
Moving Average Crossover Strategy with RSI and Volatility filters.

Signal logic:
- BUY  when fast MA crosses above slow MA, RSI is in range, volatility is acceptable
- SELL when fast MA crosses below slow MA, RSI is in range, volatility is acceptable
- HOLD otherwise
"""
import math
from app.strategies.base import BaseStrategy, StrategySignal, SignalType


def _sma(prices: list[float], period: int) -> float:
    if len(prices) < period:
        return 0.0
    return sum(prices[-period:]) / period


def _rsi(prices: list[float], period: int = 14) -> float:
    if len(prices) < period + 1:
        return 50.0
    deltas = [prices[i] - prices[i - 1] for i in range(1, len(prices))]
    gains = [d for d in deltas if d > 0]
    losses = [-d for d in deltas if d < 0]
    if not losses:
        return 100.0
    avg_gain = sum(gains[-period:]) / period if gains else 0
    avg_loss = sum(losses[-period:]) / period if losses else 0.0001
    rs = avg_gain / avg_loss
    return 100 - (100 / (1 + rs))


def _volatility(prices: list[float], period: int = 20) -> float:
    """Returns the standard deviation of returns over `period` bars."""
    if len(prices) < period + 1:
        return 0.0
    returns = [
        (prices[i] - prices[i - 1]) / prices[i - 1]
        for i in range(len(prices) - period, len(prices))
    ]
    mean = sum(returns) / len(returns)
    variance = sum((r - mean) ** 2 for r in returns) / len(returns)
    return math.sqrt(variance)


class MovingAverageCrossoverStrategy(BaseStrategy):
    name = "MA Crossover + RSI + Volatility"
    description = (
        "Generates BUY/SELL signals when a fast moving average crosses a slow one, "
        "filtered by RSI to avoid overbought/oversold extremes and by volatility to "
        "avoid choppy markets."
    )

    DEFAULT_PARAMS = {
        "fast_period": 10,
        "slow_period": 30,
        "rsi_period": 14,
        "rsi_oversold": 35,
        "rsi_overbought": 65,
        "max_volatility": 0.04,
        "min_confidence": 0.55,
    }

    def __init__(self, symbol: str, timeframe: str, parameters: dict):
        merged = {**self.DEFAULT_PARAMS, **parameters}
        super().__init__(symbol, timeframe, merged)

    def generate_signal(self, prices: list[float], **kwargs) -> StrategySignal:
        p = self.parameters
        fast = p["fast_period"]
        slow = p["slow_period"]

        min_bars = slow + 2
        if len(prices) < min_bars:
            return StrategySignal(
                signal=SignalType.HOLD,
                confidence=0.0,
                reasoning=f"Insufficient data: need {min_bars} bars, got {len(prices)}",
                symbol=self.symbol,
                timeframe=self.timeframe,
            )

        fast_ma_now = _sma(prices, fast)
        slow_ma_now = _sma(prices, slow)
        fast_ma_prev = _sma(prices[:-1], fast)
        slow_ma_prev = _sma(prices[:-1], slow)

        rsi = _rsi(prices, p["rsi_period"])
        vol = _volatility(prices)

        bullish_cross = fast_ma_prev <= slow_ma_prev and fast_ma_now > slow_ma_now
        bearish_cross = fast_ma_prev >= slow_ma_prev and fast_ma_now < slow_ma_now

        if vol > p["max_volatility"]:
            return StrategySignal(
                signal=SignalType.HOLD,
                confidence=0.0,
                reasoning=f"Volatility too high: {vol:.4f} > max {p['max_volatility']}",
                symbol=self.symbol,
                timeframe=self.timeframe,
            )

        current_price = prices[-1]
        stop_loss_pct = 0.02
        take_profit_pct = 0.04

        if bullish_cross and rsi < p["rsi_overbought"]:
            confidence = min(0.95, 0.60 + (p["rsi_overbought"] - rsi) / 100)
            sl = current_price * (1 - stop_loss_pct)
            tp = current_price * (1 + take_profit_pct)
            return StrategySignal(
                signal=SignalType.BUY,
                confidence=round(confidence, 3),
                reasoning=(
                    f"Bullish MA crossover: fast({fast})={fast_ma_now:.4f} > slow({slow})={slow_ma_now:.4f}. "
                    f"RSI={rsi:.1f} (not overbought). Vol={vol:.4f}."
                ),
                symbol=self.symbol,
                timeframe=self.timeframe,
                stop_loss=sl,
                take_profit=tp,
            )

        if bearish_cross and rsi > p["rsi_oversold"]:
            confidence = min(0.95, 0.60 + (rsi - p["rsi_oversold"]) / 100)
            sl = current_price * (1 + stop_loss_pct)
            tp = current_price * (1 - take_profit_pct)
            return StrategySignal(
                signal=SignalType.SELL,
                confidence=round(confidence, 3),
                reasoning=(
                    f"Bearish MA crossover: fast({fast})={fast_ma_now:.4f} < slow({slow})={slow_ma_now:.4f}. "
                    f"RSI={rsi:.1f} (not oversold). Vol={vol:.4f}."
                ),
                symbol=self.symbol,
                timeframe=self.timeframe,
                stop_loss=sl,
                take_profit=tp,
            )

        return StrategySignal(
            signal=SignalType.HOLD,
            confidence=0.0,
            reasoning=f"No crossover detected. fast_MA={fast_ma_now:.4f}, slow_MA={slow_ma_now:.4f}, RSI={rsi:.1f}",
            symbol=self.symbol,
            timeframe=self.timeframe,
        )
