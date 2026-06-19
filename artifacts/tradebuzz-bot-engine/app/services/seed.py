"""
Seed default data on first startup.
Creates a default user, subscription, bot settings, risk limits,
and sample strategies so the engine can run immediately in paper mode.
"""
import logging
from app.database import SessionLocal
from app.models import (
    User, Subscription, BotSettings, Strategy, RiskLimit, EmergencyStop
)

logger = logging.getLogger("tradebuzz.seed")


def seed_default_data():
    db = SessionLocal()
    try:
        # Default user
        user = db.query(User).filter(User.id == 1).first()
        if not user:
            user = User(
                id=1,
                email="admin@tradebuzz.com",
                username="admin",
                is_active=True,
                is_admin=True,
            )
            db.add(user)
            db.flush()
            logger.info("Created default admin user")

        # Active subscription
        sub = db.query(Subscription).filter(Subscription.user_id == 1).first()
        if not sub:
            sub = Subscription(user_id=1, plan="pro", is_active=True)
            db.add(sub)
            logger.info("Created default subscription")

        # Bot settings
        bot = db.query(BotSettings).filter(BotSettings.user_id == 1).first()
        if not bot:
            bot = BotSettings(
                user_id=1,
                bot_name="TradeBuzz Paper Bot",
                is_enabled=False,
                mode="PAPER",
                cycle_interval_seconds=60,
                broker_connector="mock",
                virtual_balance=10000.0,
            )
            db.add(bot)
            logger.info("Created default bot settings (PAPER mode, virtual balance $10,000)")

        # Risk limits
        limits = db.query(RiskLimit).filter(RiskLimit.user_id == 1).first()
        if not limits:
            limits = RiskLimit(
                user_id=1,
                max_daily_loss_pct=5.0,
                max_weekly_loss_pct=10.0,
                max_drawdown_pct=20.0,
                max_position_size_pct=10.0,
                max_trades_per_day=10,
                require_stop_loss=True,
                allowed_markets="crypto,stocks,forex",
            )
            db.add(limits)
            logger.info("Created default risk limits")

        # Sample strategies
        existing_strategies = db.query(Strategy).count()
        if existing_strategies == 0:
            strategies = [
                Strategy(
                    user_id=1,
                    name="ma_crossover",
                    symbol="BTC/USD",
                    market="crypto",
                    timeframe="1h",
                    stop_loss_pct=2.0,
                    take_profit_pct=4.0,
                    max_trades_per_day=3,
                    confidence_threshold=0.6,
                    parameters={
                        "fast_period": 10,
                        "slow_period": 30,
                        "rsi_period": 14,
                        "rsi_oversold": 35,
                        "rsi_overbought": 65,
                        "max_volatility": 0.04,
                    },
                    is_active=True,
                ),
                Strategy(
                    user_id=1,
                    name="ma_crossover",
                    symbol="ETH/USD",
                    market="crypto",
                    timeframe="1h",
                    stop_loss_pct=2.5,
                    take_profit_pct=5.0,
                    max_trades_per_day=3,
                    confidence_threshold=0.65,
                    parameters={
                        "fast_period": 8,
                        "slow_period": 21,
                        "rsi_period": 14,
                        "rsi_oversold": 30,
                        "rsi_overbought": 70,
                        "max_volatility": 0.05,
                    },
                    is_active=True,
                ),
                Strategy(
                    user_id=1,
                    name="ma_crossover",
                    symbol="EUR/USD",
                    market="forex",
                    timeframe="4h",
                    stop_loss_pct=1.0,
                    take_profit_pct=2.0,
                    max_trades_per_day=2,
                    confidence_threshold=0.7,
                    parameters={
                        "fast_period": 10,
                        "slow_period": 50,
                        "rsi_period": 14,
                        "rsi_oversold": 40,
                        "rsi_overbought": 60,
                        "max_volatility": 0.02,
                    },
                    is_active=True,
                ),
                Strategy(
                    user_id=1,
                    name="ma_crossover",
                    symbol="AAPL",
                    market="stocks",
                    timeframe="1d",
                    stop_loss_pct=3.0,
                    take_profit_pct=6.0,
                    max_trades_per_day=1,
                    confidence_threshold=0.7,
                    parameters={
                        "fast_period": 20,
                        "slow_period": 50,
                        "rsi_period": 14,
                        "rsi_oversold": 35,
                        "rsi_overbought": 65,
                        "max_volatility": 0.03,
                    },
                    is_active=True,
                ),
            ]
            for s in strategies:
                db.add(s)
            logger.info(f"Created {len(strategies)} sample strategies (BTC, ETH, EUR/USD, AAPL)")

        # Ensure no emergency stop is lingering
        estop = db.query(EmergencyStop).filter(EmergencyStop.is_active == True).first()
        if estop:
            logger.warning("Emergency stop was active at startup — leaving in place for safety")

        db.commit()
        logger.info("Seed complete — TradeBuzz Bot Engine ready")

    except Exception as e:
        db.rollback()
        logger.error(f"Seed failed: {e}")
    finally:
        db.close()
