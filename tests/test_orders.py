"""Exercise the broker payload boundary without a brokerage connection."""
import importlib.util
from pathlib import Path
import tempfile
import unittest
from unittest.mock import Mock, patch

spec = importlib.util.spec_from_file_location("order_server", Path(__file__).resolve().parents[1] / "scripts/order-server.py")
server = importlib.util.module_from_spec(spec)
spec.loader.exec_module(server)


class BrokerOrdersTest(unittest.TestCase):
    def setUp(self):
        directory = tempfile.TemporaryDirectory()
        self.addCleanup(directory.cleanup)
        self.broker = server.Kiwoom("", "")
        self.broker.access_token = Mock(return_value="test")
        self.broker.resolve_us_stock = Mock(return_value={"jmcode": "GOOG", "stex_tp": "ND"})
        self.row = server.pending_row(dict(ord_no="000000001", stk_cd="GOOG", ord_cntr_tp="10", ord_remnq="0003",
                                           slby_tp="2", frgn_trde_tp="00", ord_uv="99.0000", ord_time="20:01:00"))
        self.broker.pending = Mock(return_value=[self.row])
        self.orders = server.Orders(self.broker, Path(directory.name) / "orders.db")
        patcher = patch.object(server, "read_json", return_value={"ord_no":"000000002", "return_code":0})
        self.send = patcher.start()
        self.addCleanup(patcher.stop)

    def test_buy_and_sell_wire_payload(self):
        for side, tr in (("buy", "ust20000"), ("sell", "ust20001")):
            for kind in ("00", "03", "26", "27", "30", "36", "37"):
                with self.subTest(side=side, kind=kind):
                    limit = kind in server.LIMIT_TYPES
                    preview = self.orders.preview(dict(kind=kind, side=side, quantity="5", symbol="GOOG",
                                                       exchange="ND", price="99.5000" if limit else ""))
                    self.orders.submit(preview)
                    _, headers, payload = self.send.call_args.args
                    self.assertEqual(tr, headers["api-id"])
                    self.assertEqual(payload, dict(stex_tp="ND", stk_cd="GOOG", ord_qty="5", trde_tp=kind,
                                                   ord_uv="99.50" if limit else ""))

    def test_invalid_prices_and_quantities_never_sent(self):
        for kind, qty, price in [("00","1","1.0001"), ("03","1","1.25"), ("26","4","2"), ("99","5","")]:
            with self.assertRaises(server.Problem):
                self.orders.preview(dict(kind=kind, side="buy", quantity=qty, symbol="GOOG", exchange="ND", price=price))
        self.send.assert_not_called()

    def test_amend_revalidates_and_sends_once(self):
        preview = self.orders.preview(dict(action="amend", original=self.row, price="100.5"))
        duplicate = self.orders.preview(dict(action="cancel", original=self.row))
        self.orders.submit(preview)
        self.orders.submit(preview)
        with self.assertRaises(server.Problem):
            self.orders.submit(duplicate)
        _, headers, payload = self.send.call_args.args
        self.assertEqual(headers["api-id"], "ust20002")
        self.assertEqual(payload, dict(orig_ord_no="000000001", stk_cd="GOOG", stex_tp="ND", mdfy_uv="100.50"))
        self.send.assert_called_once()

    def test_partial_fill_invalidates_old_confirmation(self):
        preview = self.orders.preview(dict(action="cancel", original=self.row))
        updated = dict(self.row, remaining=2)
        self.broker.pending.return_value = [updated]
        with self.assertRaises(server.Problem):
            self.orders.submit(preview)
        self.send.assert_not_called()
        self.orders.submit(self.orders.preview(dict(action="cancel", original=updated)))
        _, headers, payload = self.send.call_args.args
        self.assertEqual(headers["api-id"], "ust20003")
        self.assertEqual(payload, dict(orig_ord_no="000000001", stk_cd="GOOG", stex_tp="ND"))

    def test_unknown_outcome_keeps_original_locked(self):
        self.send.side_effect = TimeoutError()
        for _ in range(2):
            preview = self.orders.preview(dict(action="cancel", original=self.row))
            with self.assertRaises(server.Problem):
                self.orders.submit(preview)
        self.send.assert_called_once()

    def test_order_list_paginates_and_keeps_current_order_number(self):
        broker = server.Kiwoom("", "")
        row = dict(ord_cntr_tp="11", orig_ord_no="000000001", ord_no="000000002", ord_remnq="0002",
                   stk_cd="GOOG", slby_tp="2", frgn_trde_tp="00", ord_uv="99.00", mdfy_uv="101.00")
        pages = [({"return_code":0, "result_list":[dict(row, ord_remnq="0")]}, {"cont-yn":"Y", "next-key":"next"}),
                 ({"return_code":0, "result_list":[row]}, {})]
        with patch.object(server, "wait_for_kiwoom_read"), patch.object(server, "read_page", side_effect=pages) as read:
            result = broker.pending("token")
            self.assertEqual(read.call_args.args[1]["next-key"], "next")
        self.assertEqual([(item["number"],item["price"]) for item in result], [("000000002","101.00")])
