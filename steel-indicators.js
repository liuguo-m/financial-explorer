'use strict';

const steelMetrics = [
    ['mill_profit', '247 家钢厂盈利率', '%', '周', '观察亏损是否扩大'],
    ['blast_furnace', '247 家高炉产能利用率', '%', '周', '观察高炉供给是否收缩'],
    ['hot_metal', '247 家日均铁水产量', '万吨/日', '周', '验证实际减产'],
    ['inventory', '五大钢材总库存', '万吨', '周', '观察钢厂库存与社会库存合计'],
    ['margin', '钢铁行业营业收入利润率', '%', '月', '以相邻累计数据差分观察盈利变化'],
    ['capacity', '钢铁行业官方产能利用率', '%', '季', '观察规上行业产能使用程度'],
];

async function loadSteelIndicators() {
    const status = document.getElementById('steel-status');
    const response = await fetch('./data/steel_indicators.json', {cache: 'no-cache'});
    if (!response.ok) throw new Error('指标暂不可用');
    const {history, checked} = await response.json();
    const summary = document.getElementById('steel-summary');
    const select = document.getElementById('steel-history-picker');
    const details = document.getElementById('steel-history');
    const format = new Intl.NumberFormat('zh-CN', {maximumFractionDigits: 2});
    const series = key => Object.entries(history[key] || {}).sort(([a], [b]) => b.localeCompare(a));
    const period = (key, date, row) => {
        if (key === 'capacity') return date.slice(0, 4) + ' 年第 ' + (Number(date.slice(5, 7)) / 3) + ' 季度';
        return row.period?.endsWith('01/02') ? row.period.slice(0, 4) + ' 年 1–2 月合计' : row.period || date;
    };
    function source(url, label) {
        const a = document.createElement('a');
        a.href = url;
        a.target = '_blank';
        a.rel = 'noopener';
        a.textContent = label;
        return a;
    }
    function cell(row, value) {
        row.insertCell().textContent = value;
    }
    for (const [key, title, unit, frequency, meaning] of steelMetrics) {
        const rows = series(key);
        const tr = summary.insertRow();
        const option = new Option(title, key);
        option.disabled = !rows.length;
        select.add(option);
        const button = document.createElement('button');
        button.type = 'button';
        button.textContent = title;
        button.disabled = !rows.length;
        button.onclick = () => {
            select.value = key;
            renderHistory();
            document.getElementById('steel-history-panel').open = true;
        };
        tr.insertCell().append(button);
        cell(tr, frequency);
        if (rows.length) {
            const [date, latest] = rows[0];
            cell(tr, format.format(latest.value) + ' ' + unit);
            cell(tr, period(key, date, latest));
            tr.insertCell().append(source(latest.url, key === 'capacity' || key === 'margin' ? '国家统计局' : 'Mysteel'));
        } else {
            cell(tr, '暂无');
            cell(tr, '—');
            cell(tr, '—');
        }
        cell(tr, meaning);
    }
    function renderHistory() {
        details.replaceChildren();
        const metric = steelMetrics.find(m => m[0] === select.value);
        if (!metric) return;
        const [key, , unit] = metric;
        for (const [date, row] of series(key)) {
            const tr = details.insertRow();
            cell(tr, period(key, date, row));
            cell(tr, format.format(row.value) + ' ' + unit);
            const links = tr.insertCell();
            links.append(source(row.url, '原文'));
            if (row.previous_url) links.append(' · ', source(row.previous_url, '上期累计'));
        }
    }
    select.onchange = renderHistory;
    renderHistory();
    status.textContent = '最近检查 ' + checked.slice(0, 16).replace('T', ' ') + '（北京时间）。各指标的统计期见下表。';
}

loadSteelIndicators().catch(error => {
    document.getElementById('steel-status').textContent = '钢铁指标读取失败：' + error.message;
});
