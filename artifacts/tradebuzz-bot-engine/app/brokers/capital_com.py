"""
Capital.com Broker Connector.

Uses the Capital.com REST API v1.
Docs: https://open-api.capital.com/

Authentication:
  POST /api/v1/session  →  returns CST + X-SECURITY-TOKEN headers
  All subsequent requests pass those two headers.

Environment variables required:
  CAPITAL_COM_API_KEY      — your Capital.com API key
  CAPITAL_COM_EMAIL        — your Capital.com account email
  CAPITAL_COM_PASSWORD     — your Capital.com account password
  CAPITAL_COM_DEMO         — "true" for demo account, "false" for live (default: true)
"""
import os
import logging
from datetime import datetime, timedelta
from typing import Optional

import httpx

from app.brokers.base import (
    BrokerConnector,
    AccountBalance,
    MarketPrice,
    OrderResult,
    OpenPosition,
)

logger = logging.getLogger("tradebuzz.broker.capitalcom")

DEMO_BASE_URL = "https://demo-api-capital.backend.gbattles.com/api/v1"
LIVE_BASE_URL = "https://api-capital.backend.gbattles.com/api/v1"


class CapitalComConnector(BrokerConnector):
    """
    Capital.com broker connector.

    Implements the full BrokerConnector interface so it can be swapped
    in place of any other broker without changing the bot engine logic.

    Safety: defaults to demo mode. Set CAPITAL_COM_DEMO=false to go live.
    """

    def __init__(self):
        is_demo = os.environ.get("CAPITAL_COM_DEMO", "true").lower() != "false"
        self._base_url = DEMO_BASE_URL if is_demo else LIVE_BASE_URL
        self._api_key = os.environ.get("CAPITAL_COM_API_KEY", "")
        self._email = os.environ.get("CAPITAL_COM_EMAIL", "")
        self._password = os.environ.get("CAPITAL_COM_PASSWORD", "")
        self._is_demo = is_demo
        self._cst: Optional[str] = None
        self._security_token: Optional[str] = None
        self._session_expires: Optional[datetime] = None
        self._account_id: Optional[str] = None

        if not all([self._api_key, self._email, self._password]):
            raise ValueError(
                "Capital.com credentials missing. Set environment variables: "
                "CAPITAL_COM_API_KEY, CAPITAL_COM_EMAIL, CAPITAL_COM_PASSWORD"
            )

    def _headers(self) -> dict:
        h = {
            "X-CAP-API-KEY": self._api_key,
            "Content-Type": "application/json",
        }
        if self._cst:
            h["CST"] = self._cst
        if self._security_token:
            h["X-SECURITY-TOKEN"] = self._security_token
        return h

    def _ensure_session(self) -> None:
        """Re-authenticate if session expired or not yet established."""
        if self._cst and self._session_expires and datetime.utcnow() < self._session_expires:
            return
        self.connect()

    def connect(self) -> bool:
        try:
            resp = httpx.post(
                f"{self._base_url}/session",
                headers={"X-CAP-API-KEY": self._api_key, "Content-Type": "application/json"},
                json={
                    "identifier": self._email,
                    "password": self._password,
                    "encryptedPassword": False,
                },
                timeout=10,
            )
            resp.raise_for_status()
            self._cst = resp.headers.get("CST")
            self._security_token = resp.headers.get("X-SECURITY-TOKEN")
            self._session_expires = datetime.utcnow() + timedelta(hours=10)

            data = resp.json()
            accounts = data.get("accounts", [])
            if accounts:
                preferred = next(
                    (a for a in accounts if a.get("preferred")), accounts[0]
                )
                self._account_id = preferred.get("accountId")

            logger.info(
                f"Capital.com session established ({'DEMO' if self._is_demo else 'LIVE'}) "
                f"| account: {self._account_id}"
            )
            return True

        except Exception as e:
            logger.error(f"Capital.com connect failed: {e}")
            return False

    def get_account_balance(self) -> AccountBalance:
        self._ensure_session()
        try:
            resp = httpx.get(
                f"{self._base_url}/accounts",
                headers=self._headers(),
                timeout=10,
            )
            resp.raise_for_status()
            accounts = resp.json().get("accounts", [])
            preferred = next(
                (a for a in accounts if a.get("preferred")), accounts[0] if accounts else {}
            )
            balance = preferred.get("balance", {})
            return AccountBalance(
                total=float(balance.get("balance", 0)),
                available=float(balance.get("available", 0)),
                currency=preferred.get("currency", "USD"),
            )
        except Exception as e:
            logger.error(f"get_account_balance failed: {e}")
            return AccountBalance(total=0.0, available=0.0)

    def get_open_positions(self) -> list[OpenPosition]:
        self._ensure_session()
        try:
            resp = httpx.get(
                f"{self._base_url}/positions",
                headers=self._headers(),
                timeout=10,
            )
            resp.raise_for_status()
            positions = []
            for p in resp.json().get("positions", []):
                pos = p.get("position", {})
                market = p.get("market", {})
                direction = pos.get("direction", "BUY")
                size = float(pos.get("size", 0))
                open_price = float(pos.get("level", 0))
                current = float(market.get("bid", open_price))
                if direction == "BUY":
                    pnl = (current - open_price) * size
                else:
                    pnl = (open_price - current) * size
                positions.append(
                    OpenPosition(
                        symbol=market.get("epic", ""),
                        direction=direction,
                        quantity=size,
                        entry_price=open_price,
                        current_price=current,
                        unrealised_pnl=round(pnl, 4),
                        position_id=pos.get("dealId", ""),
                    )
                )
            return positions
        except Exception as e:
            logger.error(f"get_open_positions failed: {e}")
            return []

    def get_market_price(self, symbol: str) -> MarketPrice:
        self._ensure_session()
        try:
            resp = httpx.get(
                f"{self._base_url}/prices/{symbol}",
                headers=self._headers(),
                params={"resolution": "MINUTE", "max": 1},
                timeout=10,
            )
            resp.raise_for_status()
            prices = resp.json().get("prices", [{}])
            latest = prices[-1] if prices else {}
            bid = float(latest.get("closePrice", {}).get("bid", 0))
            ask = float(latest.get("closePrice", {}).get("ask", 0))
            last = (bid + ask) / 2 if bid and ask else 0
            return MarketPrice(
                symbol=symbol,
                bid=bid,
                ask=ask,
                last=last,
                timestamp=datetime.utcnow().isoformat(),
            )
        except Exception as e:
            logger.error(f"get_market_price({symbol}) failed: {e}")
            return MarketPrice(symbol=symbol, bid=0, ask=0, last=0, timestamp=datetime.utcnow().isoformat())

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
        self._ensure_session()
        try:
            payload: dict = {
                "epic": symbol,
                "direction": direction,
                "size": quantity,
                "guaranteedStop": False,
            }
            if stop_loss:
                payload["stopLevel"] = stop_loss
            if take_profit:
                payload["profitLevel"] = take_profit

            resp = httpx.post(
                f"{self._base_url}/positions",
                headers=self._headers(),
                json=payload,
                timeout=15,
            )
            resp.raise_for_status()
            data = resp.json()
            deal_ref = data.get("dealReference", "")

            confirm = httpx.get(
                f"{self._base_url}/confirms/{deal_ref}",
                headers=self._headers(),
                timeout=10,
            )
            confirm.raise_for_status()
            confirmed = confirm.json()

            fill_price = float(confirmed.get("level", 0))
            deal_id = confirmed.get("dealId", deal_ref)
            status = confirmed.get("dealStatus", "ACCEPTED")

            logger.info(f"Capital.com order placed: {direction} {quantity} {symbol} @ {fill_price} | deal={deal_id}")

            return OrderResult(
                order_id=deal_id,
                status="FILLED" if status == "ACCEPTED" else status,
                symbol=symbol,
                direction=direction,
                quantity=quantity,
                price=fill_price,
            )
        except Exception as e:
            logger.error(f"place_order failed: {e}")
            return OrderResult(
                order_id="",
                status="ERROR",
                symbol=symbol,
                direction=direction,
                quantity=quantity,
                price=0,
                error=str(e),
            )

    def close_position(self, position_id: str, symbol: str) -> OrderResult:
        self._ensure_session()
        try:
            resp = httpx.delete(
                f"{self._base_url}/positions/{position_id}",
                headers=self._headers(),
                timeout=15,
            )
            resp.raise_for_status()
            data = resp.json()
            deal_ref = data.get("dealReference", "")

            confirm = httpx.get(
                f"{self._base_url}/confirms/{deal_ref}",
                headers=self._headers(),
                timeout=10,
            )
            confirm.raise_for_status()
            confirmed = confirm.json()
            close_price = float(confirmed.get("level", 0))

            logger.info(f"Capital.com position closed: {position_id} @ {close_price}")
            return OrderResult(
                order_id=position_id,
                status="CLOSED",
                symbol=symbol,
                direction="CLOSE",
                quantity=0,
                price=close_price,
            )
        except Exception as e:
            logger.error(f"close_position({position_id}) failed: {e}")
            return OrderResult(
                order_id=position_id,
                status="ERROR",
                symbol=symbol,
                direction="CLOSE",
                quantity=0,
                price=0,
                error=str(e),
            )

    def cancel_order(self, order_id: str) -> bool:
        logger.info(f"Capital.com: cancel_order({order_id}) — Capital.com positions are market orders, nothing to cancel")
        return True

    def is_market_open(self, symbol: str) -> bool:
        self._ensure_session()
        try:
            resp = httpx.get(
                f"{self._base_url}/markets/{symbol}",
                headers=self._headers(),
                timeout=10,
            )
            resp.raise_for_status()
            instrument = resp.json().get("instrument", {})
            return instrument.get("marketStatus", "TRADEABLE") == "TRADEABLE"
        except Exception as e:
            logger.warning(f"is_market_open({symbol}) check failed: {e} — assuming open")
            return True
