const $ = sel => document.querySelector(sel);

const state = {
  sortKey: 'log_date',
  sortAsc: false,
  rows: []
};

function fmtMoney(n){ return (Number(n)||0).toLocaleString(undefined,{style:'currency',currency:'USD'}); }

// Token handling
let TOKEN = localStorage.getItem('AUTH_TOKEN') || '';
function headers(){ return TOKEN ? { 'X-Auth': TOKEN } : {}; }

async function fetchJSON(url){
  const res = await fetch(url, { headers: headers() });
  if(!res.ok) throw new Error(await res.text());
  return res.json();
}
async function postJSON(url, body){
  const res = await fetch(url,{method:'POST', headers:{...headers(),'Content-Type':'application/json'}, body:JSON.stringify(body)});
  if(!res.ok) throw new Error(await res.text());
  return res.json();
}
async function putJSON(url, body){
  const res = await fetch(url,{method:'PUT', headers:{...headers(),'Content-Type':'application/json'}, body:JSON.stringify(body)});
  if(!res.ok) throw new Error(await res.text());
  return res.json();
}
async function del(url){
  const res = await fetch(url,{method:'DELETE', headers: headers()});
  if(!res.ok) throw new Error(await res.text());
  return res.json();
}

function setWeek(){
  const now = new Date();
  const day = now.getDay(); // 0=Sun
  const diffToMonday = ((day + 6) % 7);
  const monday = new Date(now); monday.setDate(now.getDate() - diffToMonday);
  const sunday = new Date(monday); sunday.setDate(monday.getDate() + 6);
  const toISO = d => new Date(d.getTime() - d.getTimezoneOffset()*60000).toISOString().slice(0,10);
  $('#from').value = toISO(monday);
  $('#to').value   = toISO(sunday);
}

async function setPayPeriod(){
  const p = await fetchJSON('/api/period/current');
  $('#from').value = p.start; $('#to').value = p.end;
}

function buildCSVLink(){
  const params = new URLSearchParams();
  ['from','to'].forEach(id => { const v = $('#'+id).value; if(v) params.set(id,v); });
  if($('#f_driver').value) params.set('driver_id',$('#f_driver').value);
  if($('#f_truck').value) params.set('truck_id',$('#f_truck').value);
  $('#csvLink').href = '/api/logs.csv?' + params.toString();
}

async function loadLists(){
  const [drivers, trucks] = await Promise.all([fetchJSON('/api/drivers'), fetchJSON('/api/trucks')]);
  const d1 = $('#driver'), d2 = $('#f_driver');
  const t1 = $('#truck'),  t2 = $('#f_truck');
  d1.innerHTML = ''; d2.innerHTML = '<option value="">All</option>';
  t1.innerHTML = ''; t2.innerHTML = '<option value="">All</option>';
  drivers.forEach(d=>{
    d1.insertAdjacentHTML('beforeend', `<option value="${d.id}">${d.name}</option>`);
    d2.insertAdjacentHTML('beforeend', `<option value="${d.id}">${d.name}</option>`);
  });
  trucks.forEach(t=>{
    t1.insertAdjacentHTML('beforeend', `<option value="${t.id}">${t.unit}</option>`);
    t2.insertAdjacentHTML('beforeend', `<option value="${t.id}">${t.unit}</option>`);
  });
}

function renderTable(){
  const tbody = $('#tbl tbody');
  const key = state.sortKey;
  const asc = state.sortAsc;
  const rows = [...state.rows].sort((a,b)=>{
    const va = a[key], vb = b[key];
    if(va === vb) return 0;
    return (va > vb ? 1 : -1) * (asc ? 1 : -1);
  });

  tbody.innerHTML = '';
  for(const r of rows){
    const pay = (r.miles * (r.rpm ?? 0)) + (r.value * (r.per_value ?? 0)) + ((r.detention_minutes/60) * (r.detention_rate ?? 0));
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td data-k="log_date">${r.log_date}</td>
      <td data-k="driver_name">${r.driver_name}</td>
      <td data-k="truck_unit">${r.truck_unit}</td>
      <td data-k="miles" contenteditable="true">${r.miles}</td>
      <td data-k="value" contenteditable="true">${r.value}</td>
      <td data-k="rpm" contenteditable="true">${r.rpm ?? ''}</td>
      <td data-k="per_value" contenteditable="true">${r.per_value ?? ''}</td>
      <td data-k="detention_minutes" contenteditable="true">${r.detention_minutes}</td>
      <td data-k="detention_rate" contenteditable="true">${r.detention_rate ?? ''}</td>
      <td>${fmtMoney(pay)}</td>
      <td><button data-id="${r.id}" class="del">Delete</button> <button data-id="${r.id}" class="approve">Approve</button></td>
    `;
    tbody.appendChild(tr);

    tr.querySelectorAll('[contenteditable]').forEach(cell=>{
      cell.addEventListener('keydown', e=>{
        if(e.key==='Enter'){ e.preventDefault(); cell.blur(); }
      });
      cell.addEventListener('blur', async ()=>{
        const updated = Object.fromEntries(Array.from(tr.querySelectorAll('[data-k]')).map(td=>[td.dataset.k, td.textContent.trim()]));
        await putJSON('/api/logs/'+r.id, {
          log_date: r.log_date,
          driver_id: r.driver_id,
          truck_id: r.truck_id,
          miles: Number(updated.miles || 0),
          value: Number(updated.value || 0),
          rpm: updated.rpm === '' ? null : Number(updated.rpm),
          per_value: updated.per_value === '' ? null : Number(updated.per_value),
          detention_minutes: Number(updated.detention_minutes || 0),
          detention_rate: updated.detention_rate === '' ? null : Number(updated.detention_rate),
          notes: r.notes || ''
        });
        await fetchAndRender();
      });
    });
  }

  // delete
  tbody.querySelectorAll('button.del').forEach(btn=>{
    btn.addEventListener('click', async ()=>{
      await del('/api/logs/'+btn.dataset.id);
      await fetchAndRender();
    });
  });

  // approve
  tbody.querySelectorAll('button.approve').forEach(btn=>{
    btn.addEventListener('click', async ()=>{
      try {
        await postJSON('/api/approvals/'+btn.dataset.id+'/approve', {});
        await fetchAndRender();
        await loadApprovals();
      } catch(e) {
        alert('Approve failed (admin only): '+e.message);
      }
    });
  });
}

async function fetchAndRender(){
  const params = new URLSearchParams();
  ['from','to'].forEach(id => { const v = $('#'+id).value; if(v) params.set(id,v); });
  if($('#f_driver').value) params.set('driver_id',$('#f_driver').value);
  if($('#f_truck').value) params.set('truck_id',$('#f_truck').value);

  buildCSVLink();

  const rows = await fetchJSON('/api/logs?' + params.toString());
  state.rows = rows;
  renderTable();

  const pays = await fetchJSON('/api/payroll?' + params.toString());
  const tb = $('#tblPay tbody'); tb.innerHTML = '';
  pays.forEach(p=>{
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td>${p.driver_name}</td>
      <td>${Number(p.total_miles).toFixed(1)}</td>
      <td>${Number(p.total_value).toFixed(2)}</td>
      <td>${fmtMoney(p.total_pay)}</td>
    `;
    tb.appendChild(tr);
  });
}

async function loadApprovals(){
  try{
    const rows = await fetchJSON('/api/approvals/pending');
    const box = $('#approvalsList');
    $('#approvalsCard').style.display = '';
    if(rows.length===0){ box.textContent = 'No pending items.'; return; }
    box.innerHTML = rows.map(r => `
      <div style="margin:6px 0">
        <span class="pill">${r.log_date}</span> • ${r.driver_name} • ${r.truck_unit} • ${r.miles} mi
        <button data-id="${r.id}" class="approve2">Approve</button>
      </div>
    `).join('');
    box.querySelectorAll('button.approve2').forEach(b=>{
      b.addEventListener('click', async()=>{
        await postJSON('/api/approvals/'+b.dataset.id+'/approve',{});
        await loadApprovals();
        await fetchAndRender();
      });
    });
  }catch(e){
    // Not admin; hide card
    $('#approvalsCard').style.display='none';
  }
}

document.addEventListener('DOMContentLoaded', async ()=>{
  if(!TOKEN){
    TOKEN = prompt('Enter access token (admin or driver):') || '';
    localStorage.setItem('AUTH_TOKEN', TOKEN);
  }

  // initialize
  await setPayPeriod();
  await loadLists();
  buildCSVLink();
  await fetchAndRender();
  await loadApprovals();

  // Add log
  $('#btnAdd').addEventListener('click', async ()=>{
    const payload = {
      log_date: $('#log_date').value,
      driver_id: $('#driver').value,
      truck_id: $('#truck').value,
      miles: $('#miles').value,
      value: $('#value').value,
      rpm: $('#rpm').value === '' ? null : $('#rpm').value,
      per_value: $('#per_value').value === '' ? null : $('#per_value').value,
      detention_minutes: $('#det_min').value,
      detention_rate: $('#det_rate').value === '' ? null : $('#det_rate').value,
      notes: $('#notes').value
    };
    if(!payload.log_date || !payload.driver_id || !payload.truck_id){
      alert('Date, Driver, and Truck are required.'); return;
    }
    await postJSON('/api/logs', payload);
    ['miles','value','det_min','notes','rpm','det_rate'].forEach(id=>$('#'+id).value='');
    await fetchAndRender();
  });

  // Add driver/truck
  $('#btnAddDriver').addEventListener('click', async ()=>{
    const name = $('#newDriver').value.trim(); if(!name) return;
    await postJSON('/api/seed/driver', { name });
    $('#newDriver').value='';
    await loadLists();
  });
  $('#btnAddTruck').addEventListener('click', async ()=>{
    const unit = $('#newTruck').value.trim(); if(!unit) return;
    await postJSON('/api/seed/truck', { unit });
    $('#newTruck').value='';
    await loadLists();
  });

  // Filters
  $('#btnFetch').addEventListener('click', fetchAndRender);
  $('#btnWeek').addEventListener('click', ()=>{ setWeek(); fetchAndRender(); });
  $('#btnPayPeriod').addEventListener('click', async ()=>{ await setPayPeriod(); await fetchAndRender(); });
  document.querySelectorAll('#tbl thead th[data-k]').forEach(th=>{
    th.addEventListener('click', ()=>{
      const k = th.dataset.k;
      if(state.sortKey === k) state.sortAsc = !state.sortAsc;
      else { state.sortKey = k; state.sortAsc = true; }
      renderTable();
    });
  });
});
