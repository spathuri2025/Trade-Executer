"""
Alert Service — Telegram and Email notifications.
"""
import smtplib
import logging
from email.mime.text import MIMEText
from email.mime.multipart import MIMEMultipart
from typing import Optional

import httpx

from app.config import get_settings

logger = logging.getLogger("tradebuzz.alerts")
settings = get_settings()


class AlertService:
    def send(self, message: str, level: str = "INFO") -> None:
        prefix = {"INFO": "ℹ️", "WARNING": "⚠️", "ERROR": "🚨", "TRADE": "💹", "CRITICAL": "🔴"}.get(level, "📢")
        full_message = f"{prefix} [TradeBuzz] {message}"

        self._send_telegram(full_message)
        self._send_email(subject=f"[TradeBuzz] {level}", body=full_message)

    def _send_telegram(self, message: str) -> None:
        token = settings.TELEGRAM_BOT_TOKEN
        chat_id = settings.TELEGRAM_CHAT_ID
        if not token or not chat_id:
            return
        try:
            url = f"https://api.telegram.org/bot{token}/sendMessage"
            httpx.post(url, json={"chat_id": chat_id, "text": message}, timeout=5)
        except Exception as e:
            logger.warning(f"Telegram alert failed: {e}")

    def _send_email(self, subject: str, body: str) -> None:
        host = settings.EMAIL_SMTP_HOST
        user = settings.EMAIL_SMTP_USER
        password = settings.EMAIL_SMTP_PASSWORD
        to = settings.EMAIL_TO
        if not all([host, user, password, to]):
            return
        try:
            msg = MIMEMultipart()
            msg["From"] = settings.EMAIL_FROM or user
            msg["To"] = to
            msg["Subject"] = subject
            msg.attach(MIMEText(body, "plain"))
            with smtplib.SMTP(host, settings.EMAIL_SMTP_PORT) as server:
                server.starttls()
                server.login(user, password)
                server.sendmail(msg["From"], to, msg.as_string())
        except Exception as e:
            logger.warning(f"Email alert failed: {e}")


alert_service = AlertService()
