import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { QRCodeSVG } from 'qrcode.react';
import { NavLink, useLocation, useNavigate } from 'react-router-dom';
import { io } from 'socket.io-client';

const API_URL = (import.meta.env.VITE_API_URL
  || `${window.location.protocol}//${window.location.hostname}:5000/api`).replace(/\/$/, '');
const SOCKET_URL = API_URL.replace(/\/api$/, '');
const PUBLIC_APP_URL = (import.meta.env.VITE_PUBLIC_APP_URL || window.location.origin).replace(/\/$/, '');
const SERVICE_CATALOG = [
  'General service',
  'Document verification',
  'Bill payment',
  'Account services',
  'Appointment consultation',
];

async function request(path, options = {}) {
  const response = await fetch(`${API_URL}${path}`, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...options.headers,
    },
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || `Request failed (${response.status})`);
  return data;
}

function localDateTime(date) {
  const value = new Date(date);
  value.setMinutes(value.getMinutes() - value.getTimezoneOffset());
  return value.toISOString().slice(0, 16);
}

function formatTime(date) {
  return new Intl.DateTimeFormat(undefined, { hour: 'numeric', minute: '2-digit' }).format(new Date(date));
}

function formatDate(date) {
  return new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }).format(new Date(date));
}

function ticketUrl(code) {
  return `${PUBLIC_APP_URL}${window.location.pathname}?ticket=${encodeURIComponent(code)}`;
}

function Icon({ name, size = 18 }) {
  const paths = {
    grid: <><rect x="3" y="3" width="7" height="7" rx="1.5" /><rect x="14" y="3" width="7" height="7" rx="1.5" /><rect x="3" y="14" width="7" height="7" rx="1.5" /><rect x="14" y="14" width="7" height="7" rx="1.5" /></>,
    queue: <><path d="M4 6h16M4 12h16M4 18h10" /><circle cx="19" cy="18" r="2" /></>,
    calendar: <><rect x="3" y="5" width="18" height="16" rx="2" /><path d="M16 3v4M8 3v4M3 10h18" /></>,
    chart: <><path d="M4 19V5M4 19h17" /><path d="m7 15 4-4 3 2 6-7" /></>,
    users: <><circle cx="9" cy="8" r="3" /><path d="M3 20v-1a6 6 0 0 1 12 0v1M16 5a3 3 0 0 1 0 6M18 14a5 5 0 0 1 3 5v1" /></>,
    clock: <><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" /></>,
    plus: <><path d="M12 5v14M5 12h14" /></>,
    refresh: <><path d="M20 7v5h-5M4 17v-5h5" /><path d="M5.5 9A7 7 0 0 1 18 6l2 6M4 12l2 6a7 7 0 0 0 12.5-3" /></>,
    arrow: <><path d="M5 12h14M13 6l6 6-6 6" /></>,
    check: <path d="m5 12 4 4L19 6" />,
    close: <><path d="m6 6 12 12M18 6 6 18" /></>,
    spark: <><path d="m12 3 1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8L12 3Z" /><path d="m19 16 .8 2.2L22 19l-2.2.8L19 22l-.8-2.2L16 19l2.2-.8L19 16Z" /></>,
  };
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{paths[name]}</svg>;
}

function App() {
  const [counters, setCounters] = useState([]);
  const [board, setBoard] = useState([]);
  const [appointments, setAppointments] = useState([]);
  const [analytics, setAnalytics] = useState(null);
  const [recommendations, setRecommendations] = useState([]);
  const [recommendationsLoading, setRecommendationsLoading] = useState(false);
  const [recommendationError, setRecommendationError] = useState('');
  const [service, setService] = useState('General service');
  const [busy, setBusy] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [lastUpdated, setLastUpdated] = useState(null);
  const [connected, setConnected] = useState(false);
  const [notice, setNotice] = useState(null);
  const [ticketReceipt, setTicketReceipt] = useState(null);
  const { pathname } = useLocation();
  const navigate = useNavigate();
  const activePage = {
    '/': 'Overview',
    '/queue': 'Live queue',
    '/recommendations': 'Recommended slots',
    '/appointments': 'Appointments',
    '/analytics': 'Analytics',
    '/services': 'Services & counters',
  }[pathname] || 'Overview';
  const isOverview = pathname === '/';
  const [tokenForm, setTokenForm] = useState({ customerName: '', counterId: '' });
  const [counterForm, setCounterForm] = useState({
    name: '',
    code: '',
    services: 'General service',
    capacity: 1,
    avgServiceMinutes: 10,
  });
  const [appointmentForm, setAppointmentForm] = useState({
    customerName: '',
    scheduledAt: localDateTime(Date.now() + 60 * 60 * 1000),
    counterId: '',
  });
  const [selectedSlot, setSelectedSlot] = useState(null);
  const dashboardRequestId = useRef(0);
  const recommendationRequestId = useRef(0);

  const serviceOptions = useMemo(() => {
    const configured = counters.flatMap((counter) => counter.services || []).filter(Boolean);
    return [...new Set([...SERVICE_CATALOG, ...configured])];
  }, [counters]);
  const serviceCounters = useMemo(() => counters.filter((counter) => (
    counter.isActive && (!counter.services.length || counter.services.includes(service))
  )), [counters, service]);

  const refresh = useCallback(async () => {
    const requestId = ++dashboardRequestId.current;
    setRefreshing(true);
    try {
      const [nextCounters, nextBoard, nextAnalytics, nextAppointments] = await Promise.all([
        request('/counters'),
        request('/board'),
        request('/analytics'),
        request('/appointments?status=booked&limit=8'),
      ]);
      if (requestId !== dashboardRequestId.current) return;
      setCounters(nextCounters);
      setBoard(nextBoard);
      setAnalytics(nextAnalytics);
      setAppointments(nextAppointments);
      setLastUpdated(new Date());
      setNotice(null);
    } catch (error) {
      if (requestId === dashboardRequestId.current) {
        setNotice({ type: 'error', text: error.message });
      }
    } finally {
      if (requestId === dashboardRequestId.current) setRefreshing(false);
    }
  }, []);

  const loadRecommendations = useCallback(async () => {
    const requestId = ++recommendationRequestId.current;
    setRecommendationsLoading(true);
    setRecommendations([]);
    try {
      const rows = await request(`/recommendations?service=${encodeURIComponent(service)}&limit=5`);
      if (requestId !== recommendationRequestId.current) return;
      setRecommendations(rows);
      setRecommendationError('');
    } catch (error) {
      if (requestId !== recommendationRequestId.current) return;
      setRecommendationError(error.message);
      setNotice({ type: 'error', text: error.message });
      setRecommendations([]);
    } finally {
      if (requestId === recommendationRequestId.current) setRecommendationsLoading(false);
    }
  }, [service]);

  useEffect(() => {
    const refreshDashboard = () => {
      refresh();
      loadRecommendations();
    };

    refresh();
    loadRecommendations();
    const interval = window.setInterval(refreshDashboard, 20000);
    const socket = io(SOCKET_URL, { reconnectionAttempts: 5 });
    socket.on('connect', () => setConnected(true));
    socket.on('disconnect', () => setConnected(false));
    socket.on('queue:updated', refreshDashboard);
    return () => {
      window.clearInterval(interval);
      socket.disconnect();
    };
  }, [refresh, loadRecommendations]);

  useEffect(() => {
    const code = new URLSearchParams(window.location.search).get('ticket');
    if (!code) return;
    request(`/public/tickets/${encodeURIComponent(code)}`)
      .then(setTicketReceipt)
      .catch((error) => setNotice({ type: 'error', text: error.message }));
  }, []);

  useEffect(() => {
    if (!notice) return undefined;
    const timeout = window.setTimeout(() => setNotice(null), 5000);
    return () => window.clearTimeout(timeout);
  }, [notice]);

  const queueRows = useMemo(() => board.flatMap((group) => [
    ...group.serving.map((token) => ({ ...token, counter: group.counter })),
    ...group.waiting.map((token) => ({ ...token, counter: group.counter })),
  ]), [board]);
  const waitingCount = board.reduce((sum, group) => sum + group.waiting.length, 0);
  const servingCount = board.reduce((sum, group) => sum + group.serving.length, 0);
  const activeCounterCount = counters.filter((counter) => counter.isActive).length;
  const noShowRate = analytics ? `${Math.round((analytics.noShowRate || 0) * 100)}%` : '—';
  const averageWait = recommendations[0]?.waitMinutes;

  async function submitToken(event) {
    event.preventDefault();
    setBusy(true);
    try {
      const token = await request('/tokens', {
        method: 'POST',
        body: JSON.stringify({
          service,
          customerName: tokenForm.customerName,
          ...(tokenForm.counterId ? { counterId: tokenForm.counterId } : {}),
        }),
      });
      setTicketReceipt({
        type: 'token',
        tokenNumber: token.tokenNumber,
        service: token.service,
        publicCode: token.publicCode,
        waitMinutes: token.waitMinutes,
        counter: counters.find((counter) => counter._id === token.counterId),
      });
      setNotice({ type: 'success', text: `Token #${token.tokenNumber} issued · estimated wait ${token.waitMinutes} min` });
      setTokenForm({ customerName: '', counterId: '' });
      await refresh();
      await loadRecommendations();
    } catch (error) {
      setNotice({ type: 'error', text: error.message });
    } finally {
      setBusy(false);
    }
  }

  async function updateToken(token, status) {
    try {
      await request(`/tokens/${token._id}/status`, {
        method: 'PATCH',
        body: JSON.stringify({ status }),
      });
      setNotice({ type: 'success', text: status === 'serving' ? `Token #${token.tokenNumber} is now serving` : `Token #${token.tokenNumber} completed` });
      await refresh();
      await loadRecommendations();
    } catch (error) {
      setNotice({ type: 'error', text: error.message });
    }
  }

  async function bookAppointment(event) {
    event.preventDefault();
    setBusy(true);
    try {
      const appointment = await request('/appointments', {
        method: 'POST',
        body: JSON.stringify({
          service,
          customerName: appointmentForm.customerName,
          scheduledAt: new Date(appointmentForm.scheduledAt).toISOString(),
          ...(appointmentForm.counterId ? { counterId: appointmentForm.counterId } : {}),
        }),
      });
      setTicketReceipt(appointment);
      setNotice({ type: 'success', text: `Appointment booked for ${formatDate(appointment.scheduledAt)}` });
      setAppointmentForm((form) => ({ ...form, customerName: '', counterId: '' }));
      setSelectedSlot(null);
      await refresh();
      await loadRecommendations();
    } catch (error) {
      setNotice({ type: 'error', text: error.message });
    } finally {
      setBusy(false);
    }
  }

  async function createCounter(event) {
    event.preventDefault();
    setBusy(true);
    try {
      await request('/counters', {
        method: 'POST',
        body: JSON.stringify({
          name: counterForm.name,
          code: counterForm.code,
          services: counterForm.services.split(',').map((item) => item.trim()).filter(Boolean),
          capacity: Number(counterForm.capacity),
          avgServiceMinutes: Number(counterForm.avgServiceMinutes),
        }),
      });
      setNotice({ type: 'success', text: `${counterForm.name} is ready to serve` });
      setCounterForm({ name: '', code: '', services: 'General service', capacity: 1, avgServiceMinutes: 10 });
      await refresh();
      await loadRecommendations();
    } catch (error) {
      setNotice({ type: 'error', text: error.message });
    } finally {
      setBusy(false);
    }
  }

  async function updateCounterServices(counter, services) {
    const updated = await request(`/counters/${counter._id}`, {
      method: 'PATCH',
      body: JSON.stringify({ services }),
    });
    setCounters((current) => current.map((item) => item._id === updated._id ? updated : item));
    setNotice({ type: 'success', text: `Services updated for ${counter.name}` });
    await loadRecommendations();
  }

  function changeService(nextService) {
    setService(nextService);
    setTokenForm((form) => ({ ...form, counterId: '' }));
    setAppointmentForm((form) => ({ ...form, counterId: '' }));
    setSelectedSlot(null);
  }

  function configureServiceCounter() {
    setCounterForm((form) => ({ ...form, services: service }));
    navigate('/services');
  }

  async function appointmentAction(appointment, action) {
    try {
      if (action === 'check-in') {
        const result = await request(`/appointments/${appointment._id}/check-in`, { method: 'POST' });
        setTicketReceipt({ type: 'token', ...result.token });
        setNotice({ type: 'success', text: `Checked in · token #${result.token.tokenNumber} issued` });
      } else {
        await request(`/appointments/${appointment._id}/no-show`, { method: 'POST' });
        setNotice({ type: 'success', text: `${appointment.customerName} marked as a no-show` });
      }
      await refresh();
      await loadRecommendations();
    } catch (error) {
      setNotice({ type: 'error', text: error.message });
    }
  }

  function chooseSlot(slot) {
    setSelectedSlot(slot);
    setAppointmentForm((form) => ({
      ...form,
      scheduledAt: localDateTime(slot.slotAt),
      counterId: slot.counterId,
    }));
    document.getElementById('booking-form')?.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }

  const maxTraffic = Math.max(1, ...(analytics?.hourly || []).map((item) => item.tokens));
  const now = new Date();
  const dateLabel = new Intl.DateTimeFormat(undefined, { weekday: 'long', month: 'long', day: 'numeric' }).format(now);
  const greeting = now.getHours() < 12 ? 'Good morning' : now.getHours() < 17 ? 'Good afternoon' : 'Good evening';

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <a className="brand" href="#" onClick={(event) => event.preventDefault()}>
          <span className="brand-mark"><span /></span>
          <span>queuewise<span className="brand-period">.</span></span>
        </a>
        <div className="workspace-label">WORKSPACE</div>
        <nav className="side-nav" aria-label="Main navigation">
          {[
            ['Overview', 'grid', '/'],
            ['Live queue', 'queue', '/queue'],
            ['Recommended slots', 'spark', '/recommendations'],
            ['Appointments', 'calendar', '/appointments'],
            ['Analytics', 'chart', '/analytics'],
            ['Services & counters', 'users', '/services'],
          ].map(([label, icon, path]) => (
            <NavLink key={label} to={path} end={path === '/'} aria-label={label} title={label} className={({ isActive }) => `nav-item ${isActive ? 'active' : ''}`}>
              <Icon name={icon} /><span>{label}</span>
              {label === 'Live queue' && waitingCount > 0 && <span className="nav-count">{waitingCount}</span>}
            </NavLink>
          ))}
        </nav>
        <div className="sidebar-spacer" />
        <div className="sidebar-help">
          <span className="help-icon"><Icon name="spark" size={17} /></span>
          <strong>Smart recommendations</strong>
          <p>Slots are ranked using your queue and service history.</p>
        </div>
        <div className="profile">
          <div className="avatar">OP</div>
          <div className="profile-copy"><strong>Operations</strong><span>Service manager</span></div>
          <span className="profile-menu">···</span>
        </div>
      </aside>

      <main className="main-content" id="overview">
        <header className="topbar">
          <div className="breadcrumb"><span>Workspace</span><span className="crumb-slash">/</span><strong>{activePage}</strong></div>
          <div className="topbar-right">
            <span className={`connection ${connected ? 'online' : ''}`}><i />{connected ? 'Live updates on' : 'Connecting'}</span>
            {lastUpdated && <span className="last-updated">Updated {formatTime(lastUpdated)}</span>}
            <span className="topbar-date">{dateLabel}</span>
            <button className="icon-button" aria-label="Refresh dashboard" title={refreshing ? 'Refreshing dashboard' : 'Refresh dashboard'} disabled={refreshing} onClick={() => {
              refresh();
              loadRecommendations();
            }}><span className={refreshing ? 'refreshing-icon' : ''}><Icon name="refresh" /></span></button>
          </div>
        </header>

        <div className="page-wrap">
          {isOverview
            ? <section className="welcome-row">
              <div>
                <div className="eyebrow"><span className="eyebrow-dot" /> SERVICE OPERATIONS</div>
                <h1>{greeting}<span className="title-comma">,</span> team</h1>
                <p className="welcome-subtitle">Here’s what’s happening across your service counters today.</p>
              </div>
              <NavLink className="primary-button" to="/queue"><Icon name="plus" size={17} /> Issue a token</NavLink>
            </section>
            : <section className="welcome-row page-title-row">
              <div>
                <div className="eyebrow"><span className="eyebrow-dot" /> SERVICE OPERATIONS</div>
                <h1>{activePage}</h1>
                <p className="welcome-subtitle">{pageDescription(pathname)}</p>
              </div>
            </section>}

          {notice && <div className={`toast ${notice.type}`} role="status"><span>{notice.type === 'success' ? <Icon name="check" size={17} /> : <Icon name="close" size={17} />}</span>{notice.text}<button onClick={() => setNotice(null)} aria-label="Dismiss notification"><Icon name="close" size={15} /></button></div>}

          {isOverview && <section className="stats-grid" aria-label="Queue summary">
            <StatCard label="Waiting in queue" value={waitingCount} meta={`${activeCounterCount} active counters`} icon="users" tone="blue" />
            <StatCard label="Currently serving" value={servingCount} meta="Across all counters" icon="queue" tone="violet" />
            <StatCard label="Recommended wait" value={averageWait == null ? '—' : `${averageWait} min`} meta={averageWait == null ? 'No wait data yet' : `For ${service}`} icon="clock" tone="amber" />
            <StatCard label="No-show rate" value={noShowRate} meta="Selected analytics period" icon="chart" tone="green" />
          </section>}

          <section className={`dashboard-grid ${isOverview ? '' : 'single-page'}`}>
            <div className="primary-column">
              {(isOverview || pathname === '/queue') && <section className="panel queue-panel" id="live-queue">
                <PanelHeading kicker="RIGHT NOW" title="Live queue" detail={`${waitingCount + servingCount} active ${waitingCount + servingCount === 1 ? 'token' : 'tokens'}`} action={<button className="text-button" onClick={refresh}>Refresh <Icon name="refresh" size={14} /></button>} />
                {counters.length === 0 ? (
                  <EmptyState title="No counters yet" text="Set up a service counter before issuing tokens." action={<NavLink className="empty-action" to="/services">Set up a counter</NavLink>} />
                ) : queueRows.length === 0 ? (
                  <EmptyState title="All clear for now" text="New tokens will appear here as soon as they’re issued." />
                ) : (
                  <div className="table-scroll">
                    <table className="queue-table">
                      <thead><tr><th>VISITOR</th><th>COUNTER</th><th>SERVICE</th><th>STATUS</th><th>ARRIVED</th><th /></tr></thead>
                      <tbody>{queueRows.map((token) => (
                        <tr key={token._id}>
                          <td><div className="visitor-cell"><span className={`token-badge ${token.status}`}>{String(token.tokenNumber).padStart(2, '0')}</span><span><strong>{token.customerName || 'Walk-in visitor'}</strong><small>Token #{token.tokenNumber}</small></span></div></td>
                          <td><span className="counter-label">{token.counter?.code}</span></td>
                          <td>{token.service}</td>
                          <td><span className={`status-pill ${token.status}`}><i />{token.status === 'serving' ? 'Serving' : 'Waiting'}</span></td>
                          <td className="muted-cell">{formatTime(token.createdAt)}</td>
                          <td className="row-action">{token.status === 'waiting'
                            ? <button className="small-action" onClick={() => updateToken(token, 'serving')}>Call in <Icon name="arrow" size={13} /></button>
                            : <button className="small-action complete-action" onClick={() => updateToken(token, 'completed')}><Icon name="check" size={13} /> Complete</button>}</td>
                        </tr>
                      ))}</tbody>
                    </table>
                  </div>
                )}
              </section>}

              {(isOverview || pathname === '/recommendations') && <section className="panel recommendation-panel">
                <PanelHeading kicker="BEAT THE RUSH" title="Recommended slots" detail="Live queue + Python demand forecast" action={<span className="ai-chip"><Icon name="spark" size={13} /> SMART PICK</span>} />
                <div className="recommendation-service">
                  <label htmlFor="service-select">Service</label>
                  <select id="service-select" value={service} onChange={(event) => {
                    changeService(event.target.value);
                  }}>
                    {serviceOptions.map((option) => <option key={option} value={option}>{option}</option>)}
                  </select>
                </div>
                {recommendations.length ? (
                  <div className="slot-list">{recommendations.slice(0, 3).map((slot, index) => (
                    <button className={`slot-card ${selectedSlot?.counterId === slot.counterId && selectedSlot?.slotAt === slot.slotAt ? 'selected' : ''}`} key={`${slot.counterId}-${slot.slotAt}`} onClick={() => chooseSlot(slot)}>
                      <span className={`slot-rank ${index === 0 ? 'best' : ''}`}>{index === 0 ? <Icon name="spark" size={14} /> : `0${index + 1}`}</span>
                      <span className="slot-main"><strong>{formatTime(slot.slotAt)}</strong><small>{slot.counterName} · {slot.counterCode}</small></span>
                      <span className="slot-wait"><strong>{slot.waitMinutes}<small> min</small></strong><small>est. wait</small></span>
                      <span className="slot-select-icon"><Icon name="arrow" size={15} /></span>
                    </button>
                  ))}</div>
                ) : recommendationsLoading
                  ? <div className="recommendation-loading" role="status"><span className="loading-spinner" />Finding the best slots for {service}…</div>
                  : recommendationError
                  ? <EmptyState title="Forecast unavailable" text={recommendationError} />
                  : serviceCounters.length === 0
                    ? <EmptyState title={`No counter assigned to ${service}`} text="Assign this service to a counter to get recommended slots." action={<button className="empty-action" onClick={configureServiceCounter}>Assign {service}</button>} />
                    : <EmptyState title="No slots available" text="All recommended windows are full. Try another service or check back later." />}
                <div className="history-note"><span className="history-dot" /> Python forecasts hourly demand from 30 days of service history.</div>
              </section>}

              {(isOverview || pathname === '/appointments') && <section className="panel appointments-panel" id="appointments">
                <PanelHeading kicker="UP NEXT" title="Appointments" detail={`${appointments.length} upcoming`} action={<button className="text-button" onClick={refresh}>View latest <Icon name="arrow" size={14} /></button>} />
                {appointments.length ? <div className="appointment-list">{appointments.map((appointment) => (
                  <div className="appointment-row" key={appointment._id}>
                    <div className="appointment-date"><strong>{new Intl.DateTimeFormat(undefined, { day: '2-digit' }).format(new Date(appointment.scheduledAt))}</strong><span>{new Intl.DateTimeFormat(undefined, { month: 'short' }).format(new Date(appointment.scheduledAt))}</span></div>
                    <div className="appointment-copy"><strong>{appointment.customerName}</strong><span>{appointment.service} · {appointment.counterId?.name || 'Assigned counter'}</span></div>
                    <span className="appointment-time">{formatTime(appointment.scheduledAt)}</span>
                    <div className="appointment-actions"><button title="Check in" aria-label={`Check in ${appointment.customerName}`} onClick={() => appointmentAction(appointment, 'check-in')}><Icon name="check" size={15} /></button><button className="no-show-button" title={new Date(appointment.scheduledAt) > new Date() ? 'Available after appointment time' : 'Mark no-show'} aria-label={`Mark ${appointment.customerName} no-show`} disabled={new Date(appointment.scheduledAt) > new Date()} onClick={() => appointmentAction(appointment, 'no-show')}><Icon name="close" size={15} /></button></div>
                  </div>
                ))}</div> : <EmptyState title="No upcoming appointments" text="Booked appointments will show up here." />}
              </section>}
            </div>

            {isOverview ? <aside className="secondary-column">
              <section className="panel issue-panel" id="issue-token">
                <div className="form-panel-title"><span className="form-icon blue-icon"><Icon name="plus" /></span><div><h2>Issue a token</h2><p>Get a visitor in the queue</p></div></div>
                <form onSubmit={submitToken} className="form-stack">
                  <label>Visitor name <span className="optional-label">OPTIONAL</span><input value={tokenForm.customerName} onChange={(event) => setTokenForm({ ...tokenForm, customerName: event.target.value })} placeholder="e.g. Alex Morgan" /></label>
                  <label>Service<select value={service} onChange={(event) => changeService(event.target.value)}>{serviceOptions.map((option) => <option key={option} value={option}>{option}</option>)}</select></label>
                  <label>Counter<select value={tokenForm.counterId} onChange={(event) => setTokenForm({ ...tokenForm, counterId: event.target.value })}><option value="">Auto-assign least busy</option>{serviceCounters.map((counter) => <option key={counter._id} value={counter._id}>{counter.name} · {counter.code}</option>)}</select></label>
                  <button className="primary-button full-width" type="submit" disabled={busy}><Icon name="plus" size={16} />{busy ? 'Please wait…' : 'Generate token'}</button>
                </form>
                <div className="form-footnote"><span className="secure-dot" /> Token number and wait estimate generated instantly</div>
              </section>

              <section className="panel booking-panel" id="booking-form">
                <div className="form-panel-title"><span className="form-icon violet-icon"><Icon name="calendar" /></span><div><h2>Book a slot</h2><p>Reserve a time that works</p></div></div>
                <form onSubmit={bookAppointment} className="form-stack">
                  <label>Visitor name<input required value={appointmentForm.customerName} onChange={(event) => setAppointmentForm({ ...appointmentForm, customerName: event.target.value })} placeholder="Full name" /></label>
                  <label>Service<select value={service} onChange={(event) => changeService(event.target.value)}>{serviceOptions.map((option) => <option key={option} value={option}>{option}</option>)}</select></label>
                  <label>Date &amp; time<input required type="datetime-local" min={localDateTime(Date.now())} value={appointmentForm.scheduledAt} onChange={(event) => {
                    setAppointmentForm({ ...appointmentForm, scheduledAt: event.target.value, counterId: '' });
                    setSelectedSlot(null);
                  }} /></label>
                  <label>Counter<select value={appointmentForm.counterId} onChange={(event) => setAppointmentForm({ ...appointmentForm, counterId: event.target.value })}><option value="">Auto-assign</option>{serviceCounters.map((counter) => <option key={counter._id} value={counter._id}>{counter.name} · {counter.code}</option>)}</select></label>
                  <button className="secondary-button full-width" type="submit" disabled={busy}><Icon name="calendar" size={16} />{busy ? 'Booking…' : 'Book appointment'}</button>
                </form>
                <p className="booking-tip"><Icon name="spark" size={14} /> Select a recommended slot to prefill the best counter and time.</p>
              </section>

              <section className="panel analytics-panel" id="analytics">
                <PanelHeading kicker="TRAFFIC" title="Recent activity" action={<span className="chart-period">7 days</span>} />
                <div className="chart-summary"><strong>{analytics?.totalTokens ?? '—'}</strong><span>tokens issued</span></div>
                <div className="bar-chart" role="img" aria-label="Token traffic by hour">
                  {(analytics?.hourly || []).map((item) => (
                    <div className="bar-column" key={item._id} title={`${item.tokens} tokens at ${item._id}:00`}>
                      <span className="bar-value" style={{ height: `${Math.max(7, (item.tokens / maxTraffic) * 100)}%` }} />
                      {item._id % 3 === 0 && <small>{String(item._id).padStart(2, '0')}</small>}
                    </div>
                  ))}
                  {!analytics?.hourly?.length && <span className="chart-empty">Traffic appears as tokens are issued</span>}
                </div>
                <div className="chart-legend"><span><i /> Tokens issued</span><span>{analytics?.completedTokens ?? 0} completed</span></div>
              </section>

              <section className="panel counter-setup-panel">
                <PanelHeading kicker="YOUR SERVICE DESK" title="Counter setup" detail={`${counters.length} configured`} />
                {counters.length > 0 && <div className="counter-chip-list">{counters.map((counter) => (
                <CounterServiceEditor key={counter._id} counter={counter} requestedService={service} onSave={updateCounterServices} />
                ))}</div>}
                <form onSubmit={createCounter} className="form-stack counter-form">
                  <div className="counter-form-pair">
                    <label>Counter name<input required value={counterForm.name} onChange={(event) => setCounterForm({ ...counterForm, name: event.target.value })} placeholder="e.g. Service Desk" /></label>
                    <label>Code<input required value={counterForm.code} onChange={(event) => setCounterForm({ ...counterForm, code: event.target.value.toUpperCase() })} placeholder="e.g. A1" /></label>
                  </div>
                  <label>Services <span className="optional-label">COMMA SEPARATED</span><input value={counterForm.services} onChange={(event) => setCounterForm({ ...counterForm, services: event.target.value })} placeholder="General service, Bill payment, Document verification" /></label>
                  <div className="counter-form-pair">
                    <label>Capacity<input required type="number" min="1" value={counterForm.capacity} onChange={(event) => setCounterForm({ ...counterForm, capacity: event.target.value })} /></label>
                    <label>Avg. service min<input required type="number" min="1" value={counterForm.avgServiceMinutes} onChange={(event) => setCounterForm({ ...counterForm, avgServiceMinutes: event.target.value })} /></label>
                  </div>
                  <button className="subtle-button full-width" type="submit" disabled={busy}><Icon name="plus" size={15} /> Add counter</button>
                </form>
              </section>
            </aside> : <div className="secondary-column">
              {pathname === '/queue' && <section className="panel issue-panel" id="issue-token">
                <div className="form-panel-title"><span className="form-icon blue-icon"><Icon name="plus" /></span><div><h2>Issue a token</h2><p>Get a visitor in the queue</p></div></div>
                <form onSubmit={submitToken} className="form-stack">
                  <label>Visitor name <span className="optional-label">OPTIONAL</span><input value={tokenForm.customerName} onChange={(event) => setTokenForm({ ...tokenForm, customerName: event.target.value })} placeholder="e.g. Alex Morgan" /></label>
                  <label>Service<select value={service} onChange={(event) => changeService(event.target.value)}>{serviceOptions.map((option) => <option key={option} value={option}>{option}</option>)}</select></label>
                  <label>Counter<select value={tokenForm.counterId} onChange={(event) => setTokenForm({ ...tokenForm, counterId: event.target.value })}><option value="">Auto-assign least busy</option>{serviceCounters.map((counter) => <option key={counter._id} value={counter._id}>{counter.name} · {counter.code}</option>)}</select></label>
                  <button className="primary-button full-width" type="submit" disabled={busy}><Icon name="plus" size={16} />{busy ? 'Please wait…' : 'Generate token'}</button>
                </form>
                <div className="form-footnote"><span className="secure-dot" /> Token number and wait estimate generated instantly</div>
              </section>}
              {pathname === '/appointments' && <section className="panel booking-panel" id="booking-form">
                <div className="form-panel-title"><span className="form-icon violet-icon"><Icon name="calendar" /></span><div><h2>Book a slot</h2><p>Reserve a time that works</p></div></div>
                <form onSubmit={bookAppointment} className="form-stack">
                  <label>Visitor name<input required value={appointmentForm.customerName} onChange={(event) => setAppointmentForm({ ...appointmentForm, customerName: event.target.value })} placeholder="Full name" /></label>
                  <label>Service<select value={service} onChange={(event) => changeService(event.target.value)}>{serviceOptions.map((option) => <option key={option} value={option}>{option}</option>)}</select></label>
                  <label>Date &amp; time<input required type="datetime-local" min={localDateTime(Date.now())} value={appointmentForm.scheduledAt} onChange={(event) => {
                    setAppointmentForm({ ...appointmentForm, scheduledAt: event.target.value, counterId: '' });
                    setSelectedSlot(null);
                  }} /></label>
                  <label>Counter<select value={appointmentForm.counterId} onChange={(event) => setAppointmentForm({ ...appointmentForm, counterId: event.target.value })}><option value="">Auto-assign</option>{serviceCounters.map((counter) => <option key={counter._id} value={counter._id}>{counter.name} · {counter.code}</option>)}</select></label>
                  <button className="secondary-button full-width" type="submit" disabled={busy}><Icon name="calendar" size={16} />{busy ? 'Booking…' : 'Book appointment'}</button>
                </form>
                <p className="booking-tip"><Icon name="spark" size={14} /> Select a recommended slot to prefill the best counter and time.</p>
              </section>}
              {pathname === '/analytics' && <section className="panel analytics-panel" id="analytics">
                <PanelHeading kicker="TRAFFIC" title="Recent activity" action={<span className="chart-period">7 days</span>} />
                <div className="chart-summary"><strong>{analytics?.totalTokens ?? '—'}</strong><span>tokens issued</span></div>
                <div className="bar-chart" role="img" aria-label="Token traffic by hour">
                  {(analytics?.hourly || []).map((item) => (
                    <div className="bar-column" key={item._id} title={`${item.tokens} tokens at ${item._id}:00`}>
                      <span className="bar-value" style={{ height: `${Math.max(7, (item.tokens / maxTraffic) * 100)}%` }} />
                      {item._id % 3 === 0 && <small>{String(item._id).padStart(2, '0')}</small>}
                    </div>
                  ))}
                  {!analytics?.hourly?.length && <span className="chart-empty">Traffic appears as tokens are issued</span>}
                </div>
                <div className="chart-legend"><span><i /> Tokens issued</span><span>{analytics?.completedTokens ?? 0} completed</span></div>
              </section>}
              {pathname === '/services' && <section className="panel counter-setup-panel">
                <PanelHeading kicker="YOUR SERVICE DESK" title="Counter setup" detail={`${counters.length} configured`} />
                {counters.length > 0 && <div className="counter-chip-list">{counters.map((counter) => (
                  <CounterServiceEditor key={counter._id} counter={counter} requestedService={service} onSave={updateCounterServices} />
                ))}</div>}
                <form onSubmit={createCounter} className="form-stack counter-form">
                  <div className="counter-form-pair">
                    <label>Counter name<input required value={counterForm.name} onChange={(event) => setCounterForm({ ...counterForm, name: event.target.value })} placeholder="e.g. Service Desk" /></label>
                    <label>Code<input required value={counterForm.code} onChange={(event) => setCounterForm({ ...counterForm, code: event.target.value.toUpperCase() })} placeholder="e.g. A1" /></label>
                  </div>
                  <label>Services <span className="optional-label">COMMA SEPARATED</span><input value={counterForm.services} onChange={(event) => setCounterForm({ ...counterForm, services: event.target.value })} placeholder="General service, Bill payment, Document verification" /></label>
                  <div className="counter-form-pair">
                    <label>Capacity<input required type="number" min="1" value={counterForm.capacity} onChange={(event) => setCounterForm({ ...counterForm, capacity: event.target.value })} /></label>
                    <label>Avg. service min<input required type="number" min="1" value={counterForm.avgServiceMinutes} onChange={(event) => setCounterForm({ ...counterForm, avgServiceMinutes: event.target.value })} /></label>
                  </div>
                  <button className="subtle-button full-width" type="submit" disabled={busy}><Icon name="plus" size={15} /> Add counter</button>
                </form>
              </section>}
            </div>}
          </section>

          <footer className="footer-note"><span>queuewise<span className="brand-period">.</span></span><span>Service, without the wait.</span><span>{new Date().getFullYear()} · Live operations</span></footer>
        </div>
      </main>
      {ticketReceipt && <div className="qr-overlay" role="presentation" onClick={() => setTicketReceipt(null)}>
        <section className="qr-dialog" role="dialog" aria-modal="true" aria-labelledby="qr-title" onClick={(event) => event.stopPropagation()}>
          <button className="qr-close" aria-label="Close ticket" onClick={() => setTicketReceipt(null)}><Icon name="close" size={18} /></button>
          <span className="qr-dialog-icon"><Icon name="spark" /></span>
          <div className="panel-kicker">{ticketReceipt.type === 'token' ? 'QUEUE TICKET' : 'APPOINTMENT CONFIRMED'}</div>
          <h2 id="qr-title">{ticketReceipt.type === 'token' ? `Token #${ticketReceipt.tokenNumber}` : 'Your appointment is booked'}</h2>
          <p className="qr-service">{ticketReceipt.service}</p>
          <div className="qr-code-wrap"><QRCodeSVG value={ticketUrl(ticketReceipt.publicCode)} size={184} level="M" includeMargin /></div>
          <div className="qr-details">
            {ticketReceipt.counter?.name && <span>{ticketReceipt.counter.name}{ticketReceipt.counter.code ? ` · ${ticketReceipt.counter.code}` : ''}</span>}
            {ticketReceipt.waitMinutes != null && <span>Estimated wait · {ticketReceipt.waitMinutes} min</span>}
            {ticketReceipt.scheduledAt && <span>Scheduled · {formatDate(ticketReceipt.scheduledAt)}</span>}
            {ticketReceipt.status && <span>Status · {ticketReceipt.status.replace('_', ' ')}</span>}
          </div>
          <p className="qr-caption">Scan to check ticket status. Your QR code does not include personal details.</p>
        </section>
      </div>}
    </div>
  );
}

function StatCard({ label, value, meta, icon, tone }) {
  return <article className="stat-card"><div className={`stat-icon ${tone}`}><Icon name={icon} /></div><div className="stat-content"><span>{label}</span><strong>{value}</strong><small>{meta}</small></div><span className={`stat-accent ${tone}`} /></article>;
}

function PanelHeading({ kicker, title, detail, action }) {
  return <div className="panel-heading"><div><div className="panel-kicker">{kicker}</div><div className="panel-title-row"><h2>{title}</h2>{detail && <span className="panel-detail">{detail}</span>}</div></div>{action}</div>;
}

function EmptyState({ title, text, action }) {
  return <div className="empty-state"><span className="empty-icon"><Icon name="spark" size={18} /></span><strong>{title}</strong><p>{text}</p>{action}</div>;
}

function pageDescription(pathname) {
  const descriptions = {
    '/queue': 'Issue tokens and manage visitors waiting at your service counters.',
    '/recommendations': 'Compare quieter counters and time windows for each service.',
    '/appointments': 'Book appointments and check visitors in when they arrive.',
    '/analytics': 'Review service demand, completions, and no-show patterns.',
    '/services': 'Configure counters and choose which services each one handles.',
  };
  return descriptions[pathname] || 'Manage your service operations.';
}

function CounterServiceEditor({ counter, requestedService, onSave }) {
  const [services, setServices] = useState((counter.services || []).join(', '));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  async function submit(event) {
    event.preventDefault();
    setSaving(true);
    setError('');
    try {
      const values = [...new Set(services.split(',').map((item) => item.trim()).filter(Boolean))];
      await onSave(counter, values);
      setServices(values.join(', '));
    } catch (saveError) {
      setError(saveError.message);
    } finally {
      setSaving(false);
    }
  }

  async function assignRequestedService() {
    const values = [...new Set([...services.split(',').map((item) => item.trim()).filter(Boolean), requestedService])];
    setSaving(true);
    setError('');
    try {
      await onSave(counter, values);
      setServices(values.join(', '));
    } catch (saveError) {
      setError(saveError.message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="counter-chip">
      <div className="counter-chip-summary">
        <span className="counter-chip-mark">{counter.code}</span>
        <span><strong>{counter.name}</strong><small>{counter.capacity} {counter.capacity === 1 ? 'service lane' : 'service lanes'}</small></span>
        <i className={counter.isActive ? 'active' : ''} title={counter.isActive ? 'Active' : 'Inactive'} />
      </div>
      <form className="counter-service-form" onSubmit={submit}>
        <label>Supported services<input value={services} onChange={(event) => setServices(event.target.value)} placeholder="Leave blank to accept all services" /></label>
        <button className="subtle-button" type="submit" disabled={saving}>{saving ? 'Saving…' : 'Save services'}</button>
        {error && <span className="counter-service-error">{error}</span>}
      </form>
      {counter.services.length > 0 && !counter.services.includes(requestedService)
        && <button className="assign-service-button" type="button" disabled={saving} onClick={assignRequestedService}>
          {saving ? 'Assigning…' : `Add ${requestedService} to ${counter.name}`}
        </button>}
    </div>
  );
}

export default App;
