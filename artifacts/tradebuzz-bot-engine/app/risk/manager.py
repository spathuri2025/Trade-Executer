"""
Risk Management Module.

Before any trade is executed, ALL checks below must pass.
If any check fails, the trade is blocked and the reason is logged.
"""
from dataclasses import dataclass
from datetime import datetime, timedelta
from sqlalchemy.orm import Session
from app.models import Trade, RiskLimit, BotSettings, EmergencyStop, Subscription
from app.config import get_settings

settings = get_settings()


@dataclass
class RiskCheckResult:
    passed: bool
    reason: str
    checks: dict[str, bool]


class RiskManager:
    def __init__(self, db: Session):
        self.db = db

    def check_all(
        self,
        user_id: int,
        symbol: str,
        direction: str,
        stop_loss: float | None,
        proposed_quantity: float,
        current_price: float,
    ) -> RiskCheckResult:
        checks: dict[str, bool] = {}
        failure_reasons: list[str] = []

        # 1. Active subscription
        sub = (
            self.db.query(Subscription)
            .filter(Subscription.user_id == user_id, Subscription.is_active == True)
            .first()
        )
        checks["active_subscription"] = sub is not None
        if not checks["active_subscription"]:
            failure_reasons.append("No active subscription")

        # 2. Bot enabled
        bot = (
            self.db.query(BotSettings)
            .filter(BotSettings.user_id == user_id)
            .first()
        )
        checks["bot_enabled"] = bool(bot and bot.is_enabled)
        if not checks["bot_enabled"]:
            failure_reasons.append("Bot is not enabled")

        # 3. Live mode safety gate
        if bot and bot.mode == "LIVE":
            live_ok = settings.LIVE_TRADING_ENABLED
            checks["live_trading_enabled"] = live_ok
            if not live_ok:
                failure_reasons.append(
                    "Live trading attempted but LIVE_TRADING_ENABLED env var is false"
                )
        else:
            checks["live_trading_enabled"] = True

        # 4. Emergency stop
        estop = (
            self.db.query(EmergencyStop)
            .filter(EmergencyStop.is_active == True)
            .first()
        )
        checks["no_emergency_stop"] = estop is None
        if not checks["no_emergency_stop"]:
            failure_reasons.append(f"Emergency stop is active: {estop.reason if estop else ''}")

        # 5. Risk limits
        limits = (
            self.db.query(RiskLimit)
            .filter(RiskLimit.user_id == user_id, RiskLimit.is_active == True)
            .first()
        )
        if not limits:
            checks["risk_limits_configured"] = False
            failure_reasons.append("No risk limits configured for user")
        else:
            checks["risk_limits_configured"] = True

            # 6. Stop loss required
            checks["stop_loss_present"] = (not limits.require_stop_loss) or (stop_loss is not None)
            if not checks["stop_loss_present"]:
                failure_reasons.append("Stop loss is required but not provided")

            # 7. Max trades per day
            today_start = datetime.utcnow().replace(hour=0, minute=0, second=0, microsecond=0)
            trades_today = (
                self.db.query(Trade)
                .filter(
                    Trade.user_id == user_id,
                    Trade.opened_at >= today_start,
                )
                .count()
            )
            checks["max_trades_per_day"] = trades_today < limits.max_trades_per_day
            if not checks["max_trades_per_day"]:
                failure_reasons.append(
                    f"Daily trade limit reached: {trades_today}/{limits.max_trades_per_day}"
                )

            # 8. Max daily loss
            today_closed = (
                self.db.query(Trade)
                .filter(
                    Trade.user_id == user_id,
                    Trade.opened_at >= today_start,
                    Trade.status == "CLOSED",
                )
                .all()
            )
            daily_pnl = sum(t.pnl for t in today_closed)
            balance = bot.virtual_balance if bot else 10000.0
            daily_loss_pct = (-daily_pnl / balance * 100) if balance else 0
            checks["max_daily_loss"] = daily_loss_pct < limits.max_daily_loss_pct
            if not checks["max_daily_loss"]:
                failure_reasons.append(
                    f"Daily loss limit reached: {daily_loss_pct:.1f}% >= {limits.max_daily_loss_pct}%"
                )

            # 9. Max weekly loss
            week_start = datetime.utcnow() - timedelta(days=datetime.utcnow().weekday())
            week_start = week_start.replace(hour=0, minute=0, second=0, microsecond=0)
            week_closed = (
                self.db.query(Trade)
                .filter(
                    Trade.user_id == user_id,
                    Trade.opened_at >= week_start,
                    Trade.status == "CLOSED",
                )
                .all()
            )
            weekly_pnl = sum(t.pnl for t in week_closed)
            weekly_loss_pct = (-weekly_pnl / balance * 100) if balance else 0
            checks["max_weekly_loss"] = weekly_loss_pct < limits.max_weekly_loss_pct
            if not checks["max_weekly_loss"]:
                failure_reasons.append(
                    f"Weekly loss limit reached: {weekly_loss_pct:.1f}% >= {limits.max_weekly_loss_pct}%"
                )

            # 10. Max position size
            position_value = proposed_quantity * current_price
            position_pct = (position_value / balance * 100) if balance else 100
            checks["max_position_size"] = position_pct <= limits.max_position_size_pct
            if not checks["max_position_size"]:
                failure_reasons.append(
                    f"Position too large: {position_pct:.1f}% > max {limits.max_position_size_pct}%"
                )

        all_passed = len(failure_reasons) == 0
        return RiskCheckResult(
            passed=all_passed,
            reason="; ".join(failure_reasons) if failure_reasons else "All risk checks passed",
            checks=checks,
        )
