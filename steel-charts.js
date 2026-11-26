'use strict';

const steelPrices = [
    {id: 'steel_rebar', name: '螺纹钢', color: '#1c63a3'},
    {id: 'steel_hot_rolled', name: '热轧卷板', color: '#a94c1b'},
    {id: 'steel_coke', name: '焦炭', color: '#7052a3'},
];

async function mountSteelCharts(history) {
    const frame = document.getElementById('steel-chart-panels');
    const readout = document.getElementById('steel-chart-readout');
    const range = document.getElementById('steel-chart-range');
    const controls = document.getElementById('steel-price-series');
    const dayMs = 86400000;
    const toDay = date => Math.round(Date.parse(date) / dayMs);
    const dateText = day => new Date(day * dayMs).toISOString().slice(0, 10);
    const number = value => value.toLocaleString('zh-CN', {maximumFractionDigits: 2});
    const notes = [];
    const prices = await Promise.all(steelPrices.map(async price => {
        try {
            const response = await fetch('./data/commodity_' + price.id + '.json', {cache: 'no-cache'});
            if (!response.ok) throw Error('HTTP ' + response.status);
            const data = await response.json();
            return {...price, unit: '元/吨', gap: 14,
                points: data.rows.map(([date, value]) => ({day: toDay(date), value}))};
        } catch {
            notes.push(price.name + '日线暂不可用');
            return null;
        }
    }));
    const available = prices.filter(Boolean);
    const panels = [];
    const snapshot = document.getElementById('steel-price-snapshot');
    for (const series of available) {
        const last = series.points.at(-1);
        const label = document.createElement('label');
        const checkbox = document.createElement('input');
        checkbox.type = 'checkbox';
        checkbox.checked = true;
        checkbox.value = series.id;
        label.append(checkbox, series.name);
        label.style.color = series.color;
        controls.append(label);
        const text = document.createElement('span');
        text.textContent = series.name + ' ' + number(last.value) + ' 元/吨（' + dateText(last.day) + '）';
        snapshot.append(text);
    }
    if (notes.length) document.getElementById('steel-chart-notice').textContent = notes.join(' · ');

    function panel(title, sourceSeries) {
        const section = document.createElement('section');
        const heading = document.createElement('h3');
        heading.textContent = title;
        const canvas = document.createElement('canvas');
        canvas.setAttribute('aria-label', title);
        canvas.setAttribute('role', 'img');
        section.append(heading, canvas);
        frame.append(section);
        panels.push({canvas, sourceSeries});
    }
    panel('钢铁期货主连收盘价（元/吨）', available);
    for (const [key, title, unit, frequency] of steelMetrics) {
        const gap = frequency === '周' ? 11 : frequency === '月' ? 35 : 110;
        const points = Object.entries(history[key] || {}).map(([date, record]) => ({
            day: toDay(date), value: record.value, period: record.period,
        })).sort((a, b) => a.day - b.day);
        panel(title + '（' + unit + '）', [{name: title, unit, gap, points, color: '#167361'}]);
    }
    const allDays = panels.flatMap(p => p.sourceSeries.flatMap(s => s.points.map(o => o.day)));
    if (!allDays.length) return;
    const latest = Math.max(...allDays);
    const earliest = Math.min(...allDays);
    let first = earliest;
    let focused = latest;
    let visibleDays = [];

    function updateReadout() {
        const values = panels.flatMap(p => p.visible.flatMap(s => {
            const point = s.points.find(o => o.day === focused);
            if (!point) return [];
            const period = point.period?.endsWith('01/02') ? '（1–2 月合计）' : '';
            return [s.name + ' ' + number(point.value) + ' ' + s.unit + period];
        }));
        readout.textContent = dateText(focused) + (values.length ? '　' + values.join('　') : '　该日无观测');
    }

    function cursor() {
        for (const p of panels) {
            const ctx = p.ctx;
            ctx.clearRect(0, 0, p.width, p.height);
            ctx.drawImage(p.base, 0, 0, p.width, p.height);
            const x = p.x(focused);
            ctx.strokeStyle = '#657d94';
            ctx.beginPath();
            ctx.moveTo(x, 4);
            ctx.lineTo(x, p.height - 20);
            ctx.stroke();
        }
        updateReadout();
    }

    function draw() {
        const months = Number(range.value);
        first = months ? Math.max(earliest, latest - Math.round(months * 365.25 / 12)) : earliest;
        first = Math.min(latest - 1, first);
        if (focused < first) focused = latest;
        const enabled = new Set([...controls.querySelectorAll('input:checked')].map(e => e.value));
        const days = new Set();
        for (const p of panels) {
            p.visible = p.sourceSeries.filter(s => !s.id || enabled.has(s.id)).map(s => ({
                ...s, points: s.points.filter(o => o.day >= first && Number.isFinite(o.value)),
            }));
            const points = p.visible.flatMap(s => s.points);
            points.forEach(o => days.add(o.day));
            const width = p.canvas.clientWidth;
            if (!width) return;
            const height = 126, left = 58, right = width - 12, top = 6, bottom = height - 23;
            const ratio = window.devicePixelRatio || 1;
            const base = document.createElement('canvas');
            base.width = p.canvas.width = Math.round(width * ratio);
            base.height = p.canvas.height = Math.round(height * ratio);
            const ctx = base.getContext('2d');
            ctx.scale(ratio, ratio);
            const x = d => left + (d - first) / (latest - first) * (right - left);
            p.x = x;
            p.geometry = {left, right};
            p.ctx = p.canvas.getContext('2d');
            p.ctx.scale(ratio, ratio);
            Object.assign(p, {width, height, base});
            ctx.font = '11px system-ui';
            ctx.fillStyle = '#526578';
            ctx.strokeStyle = '#dce5ed';
            const ticks = width < 500 ? 2 : 4;
            for (let i = 0; i <= ticks; i++) {
                const d = first + Math.round((latest - first) * i / ticks);
                const px = x(d);
                ctx.beginPath(); ctx.moveTo(px, top); ctx.lineTo(px, bottom); ctx.stroke();
                ctx.textAlign = i === 0 ? 'left' : i === ticks ? 'right' : 'center';
                ctx.fillText(dateText(d), px, height - 5);
            }
            if (!points.length) {
                ctx.textAlign = 'left';
                ctx.fillText('所选区间暂无观测', left + 8, 38);
                continue;
            }
            const values = points.map(o => o.value);
            const lo = Math.min(...values), hi = Math.max(...values);
            const pad = (hi - lo) * 0.08 || Math.max(1, Math.abs(lo) * 0.01);
            const y = v => bottom - (v - lo + pad) / (hi - lo + 2 * pad) * (bottom - top);
            ctx.textAlign = 'right';
            for (let i = 0; i < 3; i++) {
                const tick = hi === lo ? lo + (i - 1) * pad / 2 : lo + (hi - lo) * i / 2;
                const py = y(tick);
                ctx.beginPath(); ctx.moveTo(left, py); ctx.lineTo(right, py); ctx.stroke();
                ctx.fillText(number(tick), left - 5, py + 4);
            }
            for (const s of p.visible) {
                ctx.strokeStyle = ctx.fillStyle = s.color;
                ctx.lineWidth = 1.5;
                ctx.beginPath();
                let prev;
                for (const o of s.points) {
                    const janFeb = o.period?.endsWith('01/02') && prev && o.day - prev.day <= 62;
                    if (!prev || (o.day - prev.day > s.gap && !janFeb)) ctx.moveTo(x(o.day), y(o.value));
                    else ctx.lineTo(x(o.day), y(o.value));
                    prev = o;
                }
                ctx.stroke();
                if (!s.id || s.points.length === 1) {
                    for (const o of s.points) {
                        ctx.beginPath(); ctx.arc(x(o.day), y(o.value), 2.5, 0, Math.PI * 2); ctx.fill();
                    }
                }
            }
        }
        visibleDays = [...days].sort((a, b) => a - b);
        cursor();
    }

    function focus(event, p) {
        if (!p.geometry || !visibleDays.length) return;
        const {left, right} = p.geometry;
        const pos = event.clientX - p.canvas.getBoundingClientRect().left;
        const target = first + (pos - left) / (right - left) * (latest - first);
        focused = visibleDays.reduce((a, b) => Math.abs(a - target) <= Math.abs(b - target) ? a : b);
        cursor();
    }
    for (const p of panels) {
        p.canvas.addEventListener('pointermove', event => focus(event, p));
        p.canvas.addEventListener('pointerdown', event => focus(event, p));
    }
    range.onchange = draw;
    controls.onchange = draw;
    new ResizeObserver(draw).observe(frame);
    draw();
}
