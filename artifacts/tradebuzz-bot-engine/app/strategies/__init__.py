from app.strategies.base import BaseStrategy, StrategySignal, SignalType
from app.strategies.ma_crossover import MovingAverageCrossoverStrategy

STRATEGY_REGISTRY: dict[str, type[BaseStrategy]] = {
    "ma_crossover": MovingAverageCrossoverStrategy,
}


def get_strategy(name: str, symbol: str, timeframe: str, parameters: dict) -> BaseStrategy:
    cls = STRATEGY_REGISTRY.get(name)
    if not cls:
        raise ValueError(
            f"Unknown strategy: '{name}'. Available: {list(STRATEGY_REGISTRY.keys())}"
        )
    return cls(symbol=symbol, timeframe=timeframe, parameters=parameters)
