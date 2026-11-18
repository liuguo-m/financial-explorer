import importlib.util
import unittest
import json
import tempfile
from unittest.mock import patch
from datetime import date, timedelta
from pathlib import Path

spec = importlib.util.spec_from_file_location('commodity_data', Path(__file__).resolve().parent / 'commodity_data.py')
m = importlib.util.module_from_spec(spec)
spec.loader.exec_module(m)


class CommodityTests(unittest.TestCase):
    def setUp(self):
        self.today = date(2026, 11, 18)
        self.item = {'stale_days': 12, 'min_samples_year': 200, 'max_gap_days': 20}
        start = date(2015, 1, 1)
        self.rows = [[(start + timedelta(days=i)).isoformat(), 100 + i % 100] for i in range((self.today-start).days+1) if (start+timedelta(days=i)).weekday() < 5]

    def test_retention_correction_and_dedup(self):
        old = [['2026-11-16', 10], ['2026-11-17', 12]]
        result = m.merge(old, [['2026-11-17', 11], ['2026-11-18', 13], ['2026-11-18', 14]], self.today)
        self.assertEqual(result, [['2026-11-16', 10], ['2026-11-17', 11], ['2026-11-18', 14]])
        for bad in [[], [['2026-11-19', 12]], [['2026-11-18', 0]], [['2026-11-16', 10]]]:
            with self.assertRaises(ValueError): m.merge(old, bad, self.today)

    def test_all_windows_required(self):
        self.rows[-1][1] = 1
        s = m.statistics(self.rows, self.item, self.today)
        self.assertTrue(s['attention'])
        self.assertTrue(all(w['percentile'] < 10 for w in s['windows'].values()))
        short = [r for r in self.rows if r[0] >= '2021-01-08']
        self.assertFalse(m.statistics(short, self.item, self.today)['attention'])
        self.assertIsNone(m.statistics(short, self.item, self.today)['windows']['10']['percentile'])
        # Recent low alone is insufficient when older prices were even lower.
        for r in self.rows:
            r[1] = 1 if r[0] < '2025-11-18' else 100
        self.rows[-1][1] = 50
        s = m.statistics(self.rows, self.item, self.today)
        self.assertLess(s['windows']['1']['percentile'], 10)
        self.assertGreater(s['windows']['10']['percentile'], 10)
        self.assertFalse(s['attention'])

    def test_stale_gap_ties_and_leap(self):
        self.rows[-1][1] = 1
        self.assertFalse(m.statistics(self.rows, self.item, self.today+timedelta(days=13))['attention'])
        hole = [r for r in self.rows if not '2020-01-01' <= r[0] <= '2020-06-01']
        self.assertFalse(m.statistics(hole, self.item, self.today)['windows']['10']['complete'])
        for r in self.rows: r[1] = 10
        s = m.statistics(self.rows, self.item, self.today)
        self.assertEqual(s['windows']['1']['percentile'], 50)
        self.assertIsNone(s['windows']['1']['position'])
        self.assertEqual(m.years_before(date(2024, 2, 29), 1), date(2023, 2, 28))

    def test_failed_update_preserves_history_and_suppresses_alert(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            (root / 'data').mkdir()
            item = {**self.item, 'id': 'test', 'source': 'sina'}
            (root / 'commodities-config.json').write_text(json.dumps({'items': [item]}))
            self.rows[-1][1] = 1
            history = root / 'data/commodity_test.json'
            history.write_text(json.dumps({'source': 'sina', 'rows': self.rows}))
            before = history.read_bytes()
            with patch.object(m, 'ROOT', root), patch.object(m, 'fetch', side_effect=RuntimeError('offline')), patch.object(m.time, 'sleep'):
                m.main()
            self.assertEqual(before, history.read_bytes())
            summary = json.loads((root / 'data/commodities.json').read_text())['items'][0]
            self.assertFalse(summary['attention'])
            self.assertIn('offline', summary['error'])

    def test_hog_adapter_uses_transaction_price_and_deduplicates(self):
        raw = [[1736092800000, 88, None, None, None, 20, 15, 120], [1736092800000, 90, None, None, None, 21, 16, 121]]
        from unittest.mock import Mock
        with patch.object(m, 'request', return_value=Mock(json=lambda: {'data': raw})):
            rows = m.fetch({'source': 'nxin'})
        self.assertEqual(rows[0][1], 15)
        self.assertEqual(m.merge([], rows, self.today), [['2025-01-06', 16]])

    def test_global_oil_excludes_unfinished_day_and_preserves_negative_price(self):
        base = dict(open='30', high='31', low='-40', close='-37.63', volume='100', position='20', settlement='0')
        raw = [dict(base, date='2020-04-20'), dict(base, date='2020-04-21', close='10')]
        rows = m.global_rows(raw, date(2020, 4, 21))
        self.assertEqual(len(rows), 1)
        self.assertEqual(rows[0], ['2020-04-20', -37.63, 30, 31, -40, 100, 20, None])
        self.assertEqual(m.merge([], rows, self.today, allow_nonpositive=True), rows)
        with self.assertRaises(ValueError):
            m.merge([], rows, self.today)

    def test_umicore_unit_conversion_and_schema_validation(self):
        text = '\ufeff"Date";"€ / kg"\n"2006-01-03";88,050.00\n"2026-11-18";284,600.00\n'
        self.assertEqual(m.umicore_rows(text), [['2006-01-03', 88.05], ['2026-11-18', 284.6]])
        for bad in [text.replace('€ / kg', '$ / oz'), '<html>unavailable</html>', 'Date;€ / kg\n2026-11-18;NA']:
            with self.assertRaises(ValueError):
                m.umicore_rows(bad)

    def test_historical_fx_uses_past_rates_and_rejects_gaps(self):
        rows, fx = m.convert_usd([['2026-11-16', 10], ['2026-11-17', 20]], [['2026-11-16', 1.1], ['2026-11-18', 1.5]])
        self.assertEqual(rows, [['2026-11-16', 11], ['2026-11-17', 22]])
        self.assertEqual(fx['date'], '2026-11-16')
        for rates in [[], [['2026-11-18', 1.1]], [['2026-11-01', 1.1]]]:
            with self.assertRaises(ValueError):
                m.convert_usd([['2026-11-17', 20]], rates)

    def test_fx_migration_is_repeatable_and_retains_originals(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            (root / 'data').mkdir()
            item = {**self.item, 'id': 'test', 'source': 'umicore', 'currency': 'USD'}
            (root / 'commodities-config.json').write_text(json.dumps({'items': [item]}))
            path = root / 'data/commodity_test.json'
            path.write_text(json.dumps({'source': 'umicore', 'rows': [['2026-11-16', 10]]}))
            with patch.object(m, 'ROOT', root), patch.object(m, 'fetch', return_value=[['2026-11-17', 20]]), patch.object(m, 'fetch_usd_rates', return_value=[['2026-11-16', 1.1], ['2026-11-17', 1.2]]), patch.object(m.time, 'sleep'):
                m.main()
                m.main()
            self.assertEqual(json.loads(path.read_text())['rows'], [['2026-11-16', 11], ['2026-11-17', 24]])
            self.assertEqual(json.loads((root / 'data/commodity_test_eur_archive.json').read_text())['rows'], [['2026-11-16', 10], ['2026-11-17', 20]])

    def test_failed_fx_migration_does_not_mislabel_euros(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            (root / 'data').mkdir()
            item = {**self.item, 'id': 'test', 'source': 'umicore', 'currency': 'USD'}
            (root / 'commodities-config.json').write_text(json.dumps({'items': [item]}))
            path = root / 'data/commodity_test.json'
            path.write_text(json.dumps({'source': 'umicore', 'rows': [['2026-11-17', 20]]}))
            before = path.read_bytes()
            with patch.object(m, 'ROOT', root), patch.object(m, 'fetch_usd_rates', side_effect=RuntimeError('offline')), patch.object(m.time, 'sleep'):
                with self.assertRaises(SystemExit):
                    m.main()
            self.assertEqual(before, path.read_bytes())
            self.assertEqual(json.loads((root / 'data/commodities.json').read_text())['items'][0]['count'], 0)


if __name__ == '__main__': unittest.main()
