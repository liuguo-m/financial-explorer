'use strict';
const $ = id => document.getElementById(id);
const windows = [1, 3, 5, 10];
const metrics = ['收盘指数', 'PE', 'PB'];
const colors = ['#216dcb', '#a65624', '#087e68'];
const day = 86400000;
let catalog, selection, rows, requestId = 0;
const fmt = n => Number.isFinite(n) ? n.toLocaleString('zh-CN', {maximumFractionDigits: 2}) : '—';
const time = d => Date.parse(d);
function cutoff(date, years) {
    const end = new Date(date);
    const year = end.getUTCFullYear() - years;
    const month = end.getUTCMonth();
    const max = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
    return Date.UTC(year, month, Math.min(end.getUTCDate(), max));
}
function rank(data, column, years) {
    const last = data.at(-1);
    const start = cutoff(last[0], years);
    const period = data.filter(r => time(r[0]) >= start);
    const usable = period.map(r => r[column]).filter(v => Number.isFinite(v) && v > 0);
    const contiguous = period.length >= years * 200 && time(period[0][0]) - start <= 20 * day &&
        period.every((r, i) => !i || time(r[0]) - time(period[i - 1][0]) <= 20 * day);
    if (time(data[0][0]) > start || !contiguous || usable.length < years * 100 || !(last[column] > 0)) {
        return ['覆盖不足／当前值无效', usable.length];
    }
    let count = 0;
    for (const value of usable) count += value < last[column] ? 1 : value === last[column] ? 0.5 : 0;
    return [fmt(count * 100 / usable.length) + '%', usable.length];
}
async function read(url) {
    const response = await fetch(url, {cache: 'no-cache'});
    if (!response.ok) throw new Error('读取失败（' + response.status + '）');
    return response.json();
}
function filters() {
    const code = $('industry').value;
    const query = $('search').value.trim();
    const items = catalog.items.filter(x => x.level === Number($('level').value) && (x.name + x.code).includes(query));
    $('industry').replaceChildren(...items.map(x => new Option(x.name + ' ' + x.code, x.code)));
    if (items.some(x => x.code === code)) $('industry').value = code;
    select();
}
async function select() {
    const ticket = ++requestId;
    rows = null;
    $('summary').replaceChildren();
    $('charts').replaceChildren();
    $('cursor').textContent = '移到或点按图表查看同日数据';
    const level = Number($('level').value);
    selection = catalog.items.find(x => x.level === level && x.code === $('industry').value);
    if (!selection) {
        $('title').textContent = '行业走势';
        $('status').textContent = '没有匹配的行业';
        return;
    }
    const item = selection;
    $('title').textContent = item.name + ' · ' + item.code;
    $('status').textContent = '正在读取数据…';
    try {
        const data = await read('./data/shenwan_' + level + '_' + item.code + '.json');
        if (ticket !== requestId) return;
        rows = data;
        const check = catalog.update?.[level];
        const checkText = check ? ' · ' + check.checked + '检查' + (check.ok ? '成功' : '失败，已保留历史') : '';
        $('status').textContent = item.first + ' 至 ' + item.last + ' · ' + item.count + ' 条' + checkText;
        summary();
        charts();
    } catch (error) {
        if (ticket === requestId) $('status').textContent = error.message;
    }
}
function summary() {
    const table = document.createElement('table');
    function add(parent, tag, value) {
        const cell = document.createElement(tag);
        cell.textContent = value;
        parent.append(cell);
        return cell;
    }
    const head = table.insertRow();
    for (const value of ['指标', '最新值', ...windows.map(y => y + '年分位')]) add(head, 'th', value);
    metrics.forEach((metric, i) => {
        const tr = table.insertRow();
        add(tr, 'th', metric);
        add(tr, 'td', fmt(rows.at(-1)[i + 1]));
        for (const years of windows) {
            const [percent, n] = rank(rows, i + 1, years);
            add(add(tr, 'td', percent), 'small', n + ' 个样本');
        }
    });
    $('summary').replaceChildren(table);
}
function charts() {
    if (!rows) return;
    const years = Number($('period').value);
    const points = years ? rows.filter(r => time(r[0]) >= cutoff(rows.at(-1)[0], years)) : rows;
    const dates = points.map(r => time(r[0]));
    const width = Math.max(310, $('charts').clientWidth);
    const left = 63, right = width - 20, bottom = 132, top = 22;
    const x = d => left + (d - dates[0]) / (dates.at(-1) - dates[0] || 1) * (right - left);
    const ns = 'http://www.w3.org/2000/svg';
    const guides = [];
    $('charts').replaceChildren();
    function show(i) {
        $('cursor').textContent = points[i][0] + '　' + metrics.map((m, k) => m + ' ' + fmt(points[i][k + 1])).join('　');
        for (const guide of guides) {
            guide.setAttribute('x1', x(dates[i]));
            guide.setAttribute('x2', x(dates[i]));
            guide.setAttribute('visibility', 'visible');
        }
    }
    metrics.forEach((metric, i) => {
        const svg = document.createElementNS(ns, 'svg');
        svg.setAttribute('viewBox', '0 0 ' + width + ' 155');
        svg.setAttribute('role', 'img');
        svg.setAttribute('aria-label', metric + '历史走势');
        function add(tag, attrs, value) {
            const node = document.createElementNS(ns, tag);
            for (const [key, val] of Object.entries(attrs)) node.setAttribute(key, val);
            if (value !== undefined) node.textContent = value;
            svg.append(node);
            return node;
        }
        const values = points.map(r => r[i + 1]).filter(Number.isFinite);
        const min = values.length ? Math.min(...values) : 0;
        const max = values.length ? Math.max(...values) : 1;
        const pad = (max - min) * .06 || 1;
        const y = v => bottom - (v - min + pad) / (max - min + 2 * pad) * (bottom - top);
        for (let j = 0; j <= 3; j++) {
            const value = min + (max - min) * j / 3;
            add('line', {x1:left,x2:right,y1:y(value),y2:y(value),stroke:'#e3eaf1'});
            add('text', {x:left-7,y:y(value)+4,'text-anchor':'end','font-size':10,fill:'#526578'}, fmt(value));
        }
        add('text', {x:left,y:15,'font-size':12,fill:colors[i]}, metric);
        let path = '', previous = null;
        points.forEach((r, k) => {
            if (!Number.isFinite(r[i + 1])) {previous = null; return;}
            const command = previous !== null && dates[k] - previous <= 10 * day ? 'L' : 'M';
            path += command + x(dates[k]).toFixed(2) + ',' + y(r[i + 1]).toFixed(2);
            previous = dates[k];
        });
        add('path', {d:path,fill:'none',stroke:colors[i],'stroke-width':1.5});
        if (i === 2) {
            const ticks = width < 500 ? 2 : 4;
            for (let j = 0; j <= ticks; j++) {
                const date = dates[Math.round((dates.length - 1) * j / ticks)];
                add('text', {x:x(date),y:148,'text-anchor':j===0?'start':j===ticks?'end':'middle','font-size':10,fill:'#526578'}, new Date(date).toISOString().slice(0,10));
            }
        }
        guides.push(add('line', {x1:left,x2:left,y1:top,y2:bottom,stroke:'#7592ab',visibility:'hidden'}));
        function point(event) {
            const box = svg.getBoundingClientRect();
            const px = (event.clientX - box.left) / box.width * width;
            let lo = 0, hi = dates.length - 1;
            while (lo < hi) {
                const mid = (lo + hi) >> 1;
                if (px > (x(dates[mid]) + x(dates[mid + 1])) / 2) lo = mid + 1;
                else hi = mid;
            }
            show(lo);
        }
        svg.addEventListener('pointermove', point);
        svg.addEventListener('pointerdown', point);
        $('charts').append(svg);
    });
    show(points.length - 1);
}
$('level').onchange = filters;
$('search').oninput = filters;
$('industry').onchange = select;
$('period').onchange = charts;
window.addEventListener('resize', charts);
read('./data/shenwan.json').then(data => {catalog = data; filters();}).catch(error => {$('status').textContent = error.message;});
