"""
Bot Engine Core — manages the bot lifecycle and strategy execution cycles.

States: STOPPED → RUNNING → PAUSED → RUNNING → STOPPED
Safe by default: paper mode only unless LIVE_TRADING_ENABLED=true.
"""
import random
import logging
from datetime import datetime
from enum import Enum
from typing import Optional

from sqlalchemy.orm import Session

from app.config import get_settings
from app.models import BotSettings, Strategy, EmergencyStop
from app.models.signal import Signal
from app.brokers import get_broker
from app.brokers.mock_broker import MockBrokerConnector
from app.risk import RiskManager
from app.strategies import get_strategy
from app.strategies.base import SignalType
from app.services.paper_trading import PaperTradingEngine
from app.alerts import alert_service
from app.logs import log_event

logger = logging.getLogger("tradebuzz.engine")
settings = get_settings()


class BotState(str, Enum):
    STOPPED = "STOPPED"
    RUNNING = "RUNNING"
    PAUSED = "PAUSED"
    EMERGENCY_STOP = "EMERGENCY_STOP"


class BotEngine:
    """Singleton-ish bot engine managing all active bots."""

    def __init__(self):
        self._state: BotState = BotState.STOPPED
        self._broker: Optional[MockBrokerConnector] = None
        self._started_at: Optional[datetime] = None

    @property
    def state(self) -> BotState:
        return self._state

    def start(self, db: Session, user_id: int = 1) -> str:
        if self._state == BotState.RUNNING:
            return "Bot is already running"

        estop = db.query(EmergencyStop).filter(EmergencyStop.is_active == True).first()
        if estop:
            return f"Cannot start: emergency stop is active — {estop.reason}"

        bot = db.query(BotSettings).filter(BotSettings.user_id == user_id).first()
        if not bot:
            return "No bot settings found. Configure bot settings first."

        if bot.mode == "LIVE" and not settings.LIVE_TRADING_ENABLED:
            return "Cannot start in LIVE mode: LIVE_TRADING_ENABLED is false"

        self._broker = get_broker(bot.broker_connector or "mock", initial_balance=bot.virtual_balance)
        self._broker.connect()
        bot.is_enabled = True
        db.commit()

        self._state = BotState.RUNNING
        self._started_at = datetime.utcnow()

        log_event(db, "INFO", "BOT_STARTED", f"Bot started in {bot.mode} mode")
        alert_service.send(f"Bot started in {bot.mode} mode", "INFO")
        return f"Bot started in {bot.mode} mode"

    def stop(self, db: Session, user_id: int = 1) -> str:
        self._state = BotState.STOPPED
        bot = db.query(BotSettings).filter(BotSettings.user_id == user_id).first()
        if bot:
            bot.is_enabled = False
            db.commit()
        log_event(db, "INFO", "BOT_STOPPED", "Bot stopped")
        alert_service.send("Bot stopped", "INFO")
        return "Bot stopped"

    def pause(self, db: Session) -> str:
        if self._state != BotState.RUNNING:
            return f"Cannot pause: bot is {self._state}"
        self._state = BotState.PAUSED
        log_event(db, "INFO", "BOT_PAUSED", "Bot paused")
        return "Bot paused"

    def resume(self, db: Session) -> str:
        if self._state != BotState.PAUSED:
            return f"Cannot resume: bot is {self._state}"
        self._state = BotState.RUNNING
        log_event(db, "INFO", "BOT_RESUMED", "Bot resumed")
        return "Bot resumed"

    def emergency_stop(self, db: Session, reason: str = "Manual emergency stop") -> str:
        self._state = BotState.EMERGENCY_STOP

        estop = EmergencyStop(
            is_active=True,
            reason=reason,
            triggered_at=datetime.utcnow(),
            triggered_by="admin",
        )
        db.add(estop)

        bot = db.query(BotSettings).filter(BotSettings.user_id == 1).first()
        if bot:
            bot.is_enabled = False
        db.commit()

        log_event(db, "CRITICAL", "EMERGENCY_STOP", f"Emergency stop triggered: {reason}")
        alert_service.send(f"EMERGENCY STOP triggered: {reason}", "CRITICAL")
        return f"Emergency stop triggered: {reason}"

    def clear_emergency_stop(self, db: Session) -> str:
        estops = db.query(EmergencyStop).filter(EmergencyStop.is_active == True).all()
        for e in estops:
            e.is_active = False
            e.cleared_at = datetime.utcnow()
        db.commit()
        self._state = BotState.STOPPED
        log_event(db, "INFO", "EMERGENCY_STOP_CLEARED", "Emergency stop cleared")
        alert_service.send("Emergency stop cleared. Bot is now STOPPED.", "INFO")
        return "Emergency stop cleared. Bot is now in STOPPED state."

    def run_cycle(self, db: Session, user_id: int = 1) -> dict:
        """Execute one strategy cycle for all active strategies."""
        if self._state not in (BotState.RUNNING,):
            return {"status": self._state, "trades_attempted": 0}

        log_event(db, "INFO", "CYCLE_START", "Bot cycle started")

        if not self._broker:
            self._broker = get_broker("mock")
            self._broker.connect()

        strategies = db.query(Strategy).filter(Strategy.is_active == True).all()
        trades_attempted = 0
        signals_generated = []

        risk_mgr = RiskManager(db)
        paper_engine = PaperTradingEngine(db, self._broker)

        for strategy_row in strategies:
            try:
                strat = get_strategy(
                    name=strategy_row.name if strategy_row.name in ["ma_crossover"] else "ma_crossover",
                    symbol=strategy_row.symbol,
                    timeframe=strategy_row.timeframe,
                    parameters=strategy_row.parameters or {},
                )

                prices = self._fetch_price_history(strategy_row.symbol, bars=60)
                signal = strat.generate_signal(prices)

                signal_record = Signal(
                    strategy_id=strategy_row.id,
                    symbol=strategy_row.symbol,
                    market=strategy_row.market,
                    signal_type=signal.signal.value,
                    confidence=signal.confidence,
                    price_at_signal=prices[-1] if prices else None,
                    reasoning=signal.reasoning,
                    acted_on="PENDING",
                )
                db.add(signal_record)
                db.flush()
                signals_generated.append(signal.signal.value)

                log_event(
                    db, "INFO", "SIGNAL_GENERATED",
                    f"Signal: {signal.signal.value} for {strategy_row.symbol} (conf={signal.confidence:.2f})",
                    symbol=strategy_row.symbol,
                    strategy=strategy_row.name,
                )

                if signal.signal == SignalType.HOLD or signal.confidence < strategy_row.confidence_threshold:
                    signal_record.acted_on = "HOLD"
                    db.commit()
                    continue

                risk_result = risk_mgr.check_all(
                    user_id=user_id,
                    symbol=strategy_row.symbol,
                    direction=signal.signal.value,
                    stop_loss=signal.stop_loss,
                    proposed_quantity=0.01,
                    current_price=prices[-1] if prices else 1.0,
                )

                if not risk_result.passed:
                    signal_record.acted_on = "BLOCKED"
                    db.commit()
                    log_event(
                        db, "WARNING", "RISK_CHECK_FAILED",
                        f"Trade blocked: {risk_result.reason}",
                        symbol=strategy_row.symbol,
                    )
                    alert_service.send(
                        f"Trade blocked for {strategy_row.symbol}: {risk_result.reason}", "WARNING"
                    )
                    continue

                log_event(db, "INFO", "RISK_CHECK_PASSED", "All risk checks passed", symbol=strategy_row.symbol)

                trade = paper_engine.open_trade(
                    user_id=user_id,
                    strategy_id=strategy_row.id,
                    signal_id=signal_record.id,
                    symbol=strategy_row.symbol,
                    market=strategy_row.market,
                    direction=signal.signal.value,
                    stop_loss=signal.stop_loss,
                    take_profit=signal.take_profit,
                    quantity=0.01,
                )
                signal_record.acted_on = "TRADED"
                db.commit()
                trades_attempted += 1

                alert_service.send(
                    f"Paper trade placed: {signal.signal.value} {strategy_row.symbol} @ {trade.entry_price:.4f}",
                    "TRADE",
                )

            except Exception as e:
                log_event(db, "ERROR", "CYCLE_ERROR", f"Error in strategy cycle: {e}", symbol=strategy_row.symbol)
                alert_service.send(f"Bot cycle error for {strategy_row.symbol}: {e}", "ERROR")

        paper_engine.update_open_positions(user_id)
        log_event(db, "INFO", "CYCLE_END", f"Cycle complete. Trades attempted: {trades_attempted}")
        return {"status": "cycle_complete", "trades_attempted": trades_attempted, "signals": signals_generated}

    def _fetch_price_history(self, symbol: str, bars: int = 60) -> list[float]:
        """
        Fetch or simulate historical closing prices for strategy calculation.
        In production, replace this with real broker OHLCV data.
        """
        if not self._broker:
            return []
        current = self._broker.get_market_price(symbol).last
        prices = [current]
        for i in range(bars - 1):
            drift = random.gauss(0, 0.005)
            current = current * (1 + drift)
            prices.insert(0, max(current, 0.01))
        return prices

    def get_status(self) -> dict:
        return {
            "state": self._state,
            "started_at": self._started_at.isoformat() if self._started_at else None,
            "mode": settings.BOT_MODE,
            "live_trading_enabled": settings.LIVE_TRADING_ENABLED,
        }


bot_engine = BotEngine()
