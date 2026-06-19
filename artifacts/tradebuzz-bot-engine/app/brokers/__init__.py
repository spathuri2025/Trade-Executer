from app.brokers.base import BrokerConnector, AccountBalance, MarketPrice, OrderResult, OpenPosition
from app.brokers.mock_broker import MockBrokerConnector


def get_broker(connector_name: str, **kwargs) -> BrokerConnector:
    """Factory function to return the appropriate broker connector."""
    if connector_name == "mock":
        return MockBrokerConnector(**kwargs)
    raise ValueError(
        f"Unknown broker connector: '{connector_name}'. "
        "Available connectors: mock. "
        "To add Trading212, Capital.com, MetaTrader etc., implement BrokerConnector in brokers/<name>.py"
    )
