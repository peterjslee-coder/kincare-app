// ─── HourReports — Generate and send clinical hour reports ───
const HourReports = window.HourReports = ({ profileName, academicProgram }) => {
  const { showToast } = useToast();
  const [report, setReport] = useState(null);
  const [loading, setLoading] = useState(false);
  const [sending, setSending] = useState(false);
  const [showEmailForm, setShowEmailForm] = useState(false);
  const [recipientEmail, setRecipientEmail] = useState('');
  const [recipientName, setRecipientName] = useState('');

  // Date range — default: start of current semester or last 4 months
  const defaultTo = TimezoneHelper.getToday();
  const defaultFrom = (() => {
    const d = new Date();
    d.setMonth(d.getMonth() - 4);
    return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
  })();
  const [fromDate, setFromDate] = useState(defaultFrom);
  const [toDate, setToDate] = useState(defaultTo);

  const fetchReport = async () => {
    setLoading(true);
    try {
      const res = await apiFetch(`/api/reports/hours?from=${fromDate}&to=${toDate}`);
      if (res?.ok) {
        const data = await res.json();
        setReport(data.report);
      } else {
        showToast('Failed to generate report', 'error');
      }
    } catch (err) {
      console.error('Report fetch error:', err);
      showToast('Failed to generate report', 'error');
    }
    setLoading(false);
  };

  const handleEmail = async () => {
    if (!recipientEmail.trim()) {
      showToast('Please enter a recipient email', 'error');
      return;
    }
    setSending(true);
    try {
      const res = await apiFetch('/api/reports/hours/email', {
        method: 'POST',
        body: JSON.stringify({
          recipientEmail: recipientEmail.trim(),
          recipientName: recipientName.trim(),
          from: fromDate,
          to: toDate,
        }),
      });
      if (res?.ok) {
        showToast(`Report sent to ${recipientEmail}!`, 'success');
        setShowEmailForm(false);
        setRecipientEmail('');
        setRecipientName('');
      } else {
        const err = await res.json().catch(() => ({}));
        showToast(err.error || 'Failed to send report', 'error');
      }
    } catch (err) {
      console.error('Email error:', err);
      showToast('Failed to send report', 'error');
    }
    setSending(false);
  };

  const handlePrint = () => {
    window.print();
  };

  const formatDate = (d) => {
    if (!d) return '';
    const dt = TimezoneHelper.parseDate(d);
    return dt.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  };

  const serviceLabel = (t) => (t || '').replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());

  const formatTime = (t) => {
    if (!t) return '';
    const [h, min] = t.split(':').map(Number);
    const ampm = h >= 12 ? 'PM' : 'AM';
    const dh = h > 12 ? h - 12 : h === 0 ? 12 : h;
    return `${dh}:${String(min || 0).padStart(2, '0')} ${ampm}`;
  };

  return (
    <div>
      {/* Header & Date Range */}
      <div className="card" style={{ marginBottom: 16 }}>
        <div className="card-header"><span className="card-icon">📊</span>Generate Hour Report</div>
        <p style={{ fontSize: 13, color: 'var(--text-secondary)', margin: '0 0 16px' }}>
          Generate a verified report of your completed care hours. You can download it as a PDF or email it directly to your school.
        </p>

        <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'flex-end', marginBottom: 16 }}>
          <div>
            <label style={{ display: 'block', fontSize: 11, color: 'var(--text-tertiary)', textTransform: 'uppercase', marginBottom: 4 }}>From</label>
            <input type="date" value={fromDate} onChange={e => setFromDate(e.target.value)}
              style={{ padding: '8px 12px', borderRadius: 8, border: '1px solid #ddd', fontSize: 14 }} />
          </div>
          <div>
            <label style={{ display: 'block', fontSize: 11, color: 'var(--text-tertiary)', textTransform: 'uppercase', marginBottom: 4 }}>To</label>
            <input type="date" value={toDate} onChange={e => setToDate(e.target.value)}
              style={{ padding: '8px 12px', borderRadius: 8, border: '1px solid #ddd', fontSize: 14 }} />
          </div>
          <button onClick={fetchReport} disabled={loading} style={{
            padding: '8px 20px', background: loading ? 'var(--text-muted)' : 'var(--role-color)', color: 'var(--bg-card)',
            border: 'none', borderRadius: 8, fontSize: 14, fontWeight: 600,
            cursor: loading ? 'wait' : 'pointer', height: 38,
          }}>
            {loading ? 'Generating...' : 'Generate Report'}
          </button>
        </div>

        {/* Quick presets */}
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          {[
            { label: 'This Month', fn: () => { const n = new Date(); setFromDate(`${n.getFullYear()}-${String(n.getMonth()+1).padStart(2,'0')}-01`); setToDate(defaultTo); } },
            { label: 'Last 3 Months', fn: () => { const d = new Date(); d.setMonth(d.getMonth()-3); setFromDate(d.getFullYear() + '-' + String(d.getMonth()+1).padStart(2,'0') + '-' + String(d.getDate()).padStart(2,'0')); setToDate(defaultTo); } },
            { label: 'Last 6 Months', fn: () => { const d = new Date(); d.setMonth(d.getMonth()-6); setFromDate(d.getFullYear() + '-' + String(d.getMonth()+1).padStart(2,'0') + '-' + String(d.getDate()).padStart(2,'0')); setToDate(defaultTo); } },
            { label: 'This Year', fn: () => { setFromDate(`${new Date().getFullYear()}-01-01`); setToDate(defaultTo); } },
          ].map(p => (
            <button key={p.label} onClick={p.fn} style={{
              padding: '4px 12px', borderRadius: 16, border: '1px solid #d0d0d0',
              background: 'var(--bg-surface)', color: 'var(--text-secondary)', fontSize: 11, fontWeight: 600, cursor: 'pointer',
            }}>{p.label}</button>
          ))}
        </div>
      </div>

      {/* Report Preview */}
      {report && (
        <div id="hour-report-content">
          {/* Action buttons */}
          <div style={{ display: 'flex', gap: 10, marginBottom: 16, flexWrap: 'wrap' }} className="no-print">
            <button onClick={handlePrint} style={{
              padding: '10px 20px', background: 'var(--role-color)', color: 'var(--bg-card)', border: 'none',
              borderRadius: 8, fontSize: 14, fontWeight: 600, cursor: 'pointer',
              display: 'flex', alignItems: 'center', gap: 6,
            }}>
              <span>🖨️</span> Print / Save as PDF
            </button>
            <button onClick={() => setShowEmailForm(!showEmailForm)} style={{
              padding: '10px 20px', background: showEmailForm ? 'var(--color-warning)' : 'var(--accent-color)', color: 'var(--bg-card)',
              border: 'none', borderRadius: 8, fontSize: 14, fontWeight: 600, cursor: 'pointer',
              display: 'flex', alignItems: 'center', gap: 6,
            }}>
              <span>📧</span> Email to School
            </button>
          </div>

          {/* Email form */}
          {showEmailForm && (
            <div className="card no-print" style={{ marginBottom: 16, borderLeft: '4px solid #e8724a' }}>
              <div style={{ fontWeight: 600, fontSize: 15, marginBottom: 12 }}>Send Report via Email</div>
              <div style={{ display: 'grid', gap: 12 }}>
                <div>
                  <label style={{ display: 'block', fontSize: 12, color: 'var(--text-tertiary)', marginBottom: 4 }}>Recipient Email *</label>
                  <input type="email" value={recipientEmail} onChange={e => setRecipientEmail(e.target.value)}
                    placeholder="advisor@university.edu"
                    style={{ width: '100%', padding: '8px 12px', borderRadius: 8, border: '1px solid #ddd', fontSize: 14 }} />
                </div>
                <div>
                  <label style={{ display: 'block', fontSize: 12, color: 'var(--text-tertiary)', marginBottom: 4 }}>Recipient Name (optional)</label>
                  <input type="text" value={recipientName} onChange={e => setRecipientName(e.target.value)}
                    placeholder="Dr. Smith"
                    style={{ width: '100%', padding: '8px 12px', borderRadius: 8, border: '1px solid #ddd', fontSize: 14 }} />
                </div>
                <button onClick={handleEmail} disabled={sending} style={{
                  padding: '10px 20px', background: sending ? 'var(--text-muted)' : 'var(--accent-color)', color: 'var(--bg-card)',
                  border: 'none', borderRadius: 8, fontSize: 14, fontWeight: 600,
                  cursor: sending ? 'wait' : 'pointer',
                }}>
                  {sending ? 'Sending...' : 'Send Report'}
                </button>
              </div>
            </div>
          )}

          {/* Report card */}
          <div className="card" style={{ border: '1px solid #d0d0d0' }}>
            {/* Report header */}
            <div style={{
              background: 'var(--role-color)', margin: '-16px -16px 16px', padding: '20px 24px',
              borderRadius: '12px 12px 0 0', color: 'var(--text-on-primary)',
            }}>
              <h2 style={{ margin: '0 0 4px', fontSize: 20 }}>Clinical Hours Report</h2>
              <div style={{ fontSize: 13, opacity: 0.85 }}>InPlace Care Platform — Verified Hours</div>
            </div>

            {/* Student info */}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 12, marginBottom: 20 }}>
              <div>
                <div style={{ fontSize: 11, color: 'var(--text-tertiary)', textTransform: 'uppercase' }}>Student Name</div>
                <div style={{ fontSize: 15, fontWeight: 600 }}>{report.student.name}</div>
              </div>
              <div>
                <div style={{ fontSize: 11, color: 'var(--text-tertiary)', textTransform: 'uppercase' }}>Email</div>
                <div style={{ fontSize: 14 }}>{report.student.email}</div>
              </div>
              {report.student.academicProgram && (
                <div>
                  <div style={{ fontSize: 11, color: 'var(--text-tertiary)', textTransform: 'uppercase' }}>Program</div>
                  <div style={{ fontSize: 14 }}>
                    {report.student.academicProgram}
                    {report.student.academicProgramYear && ` (${report.student.academicProgramYear})`}
                  </div>
                </div>
              )}
              <div>
                <div style={{ fontSize: 11, color: 'var(--text-tertiary)', textTransform: 'uppercase' }}>Report Period</div>
                <div style={{ fontSize: 14 }}>{formatDate(report.dateRange.from)} — {formatDate(report.dateRange.to)}</div>
              </div>
            </div>

            {/* Summary stats */}
            <div style={{
              display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(120px, 1fr))',
              gap: 12, marginBottom: 20,
            }}>
              <div style={{ padding: 16, background: 'var(--bg-highlight)', borderRadius: 10, textAlign: 'center' }}>
                <div style={{ fontSize: 28, fontWeight: 700, color: 'var(--role-color)' }}>{report.summary.totalHours}</div>
                <div style={{ fontSize: 12, color: 'var(--text-secondary)', fontWeight: 600 }}>Total Hours</div>
              </div>
              <div style={{ padding: 16, background: 'var(--bg-primary)', borderRadius: 10, textAlign: 'center' }}>
                <div style={{ fontSize: 28, fontWeight: 700, color: 'var(--text-primary)' }}>{report.summary.totalSessions}</div>
                <div style={{ fontSize: 12, color: 'var(--text-secondary)', fontWeight: 600 }}>Sessions</div>
              </div>
              {Object.entries(report.summary.byServiceType).map(([type, data]) => (
                <div key={type} style={{ padding: 16, background: 'var(--bg-warm)', borderRadius: 10, textAlign: 'center' }}>
                  <div style={{ fontSize: 20, fontWeight: 700, color: 'var(--color-warning)' }}>{Math.round(data.hours * 10) / 10}h</div>
                  <div style={{ fontSize: 11, color: 'var(--text-secondary)', fontWeight: 600, textTransform: 'capitalize' }}>{serviceLabel(type)}</div>
                </div>
              ))}
            </div>

            {/* Session detail table */}
            <h3 style={{ margin: '0 0 10px', fontSize: 15, color: 'var(--text-primary)', borderBottom: '2px solid #1b6b5a', paddingBottom: 6 }}>
              Session Detail
            </h3>
            {report.sessions.length > 0 ? (
              <div style={{ overflowX: 'auto' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
                  <thead>
                    <tr style={{ background: 'var(--bg-primary)' }}>
                      <th style={{ padding: '8px 12px', textAlign: 'left', fontSize: 11, color: 'var(--text-tertiary)', fontWeight: 600, textTransform: 'uppercase' }}>Date</th>
                      <th style={{ padding: '8px 12px', textAlign: 'left', fontSize: 11, color: 'var(--text-tertiary)', fontWeight: 600, textTransform: 'uppercase' }}>Time</th>
                      <th style={{ padding: '8px 12px', textAlign: 'right', fontSize: 11, color: 'var(--text-tertiary)', fontWeight: 600, textTransform: 'uppercase' }}>Hours</th>
                      <th style={{ padding: '8px 12px', textAlign: 'left', fontSize: 11, color: 'var(--text-tertiary)', fontWeight: 600, textTransform: 'uppercase' }}>Type of Care</th>
                      <th style={{ padding: '8px 12px', textAlign: 'left', fontSize: 11, color: 'var(--text-tertiary)', fontWeight: 600, textTransform: 'uppercase' }}>Client</th>
                    </tr>
                  </thead>
                  <tbody>
                    {report.sessions.map((s, i) => (
                      <tr key={i} style={{ borderBottom: '1px solid #f0f0f0' }}>
                        <td style={{ padding: '8px 12px' }}>{formatDate(s.date)}</td>
                        <td style={{ padding: '8px 12px' }}>{formatTime(s.time)}</td>
                        <td style={{ padding: '8px 12px', textAlign: 'right', fontWeight: 600 }}>{s.durationHours}h</td>
                        <td style={{ padding: '8px 12px' }}>
                          <span style={{
                            padding: '2px 8px', borderRadius: 10, fontSize: 11, fontWeight: 600,
                            background: 'var(--bg-highlight)', color: 'var(--role-color)', textTransform: 'capitalize',
                          }}>{serviceLabel(s.serviceType)}</span>
                        </td>
                        <td style={{ padding: '8px 12px' }}>{s.recipientName || '\u2014'}</td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot>
                    <tr style={{ borderTop: '2px solid #333' }}>
                      <td colSpan="2" style={{ padding: '10px 12px', fontWeight: 700, fontSize: 14 }}>Total</td>
                      <td style={{ padding: '10px 12px', textAlign: 'right', fontWeight: 700, fontSize: 14, color: 'var(--role-color)' }}>
                        {report.summary.totalHours}h
                      </td>
                      <td colSpan="2"></td>
                    </tr>
                  </tfoot>
                </table>
              </div>
            ) : (
              <div style={{ padding: 24, textAlign: 'center', color: 'var(--text-muted)' }}>
                No completed sessions in this date range
              </div>
            )}

            {/* Footer */}
            <div style={{
              marginTop: 20, padding: 16, background: 'var(--bg-primary)', borderRadius: 8,
              border: '1px solid #e0e0e0',
            }}>
              <p style={{ margin: 0, fontSize: 12, color: 'var(--text-secondary)', lineHeight: 1.6 }}>
                This report was generated by <strong>InPlace</strong> (yourinplace.com), an on-demand care coordination platform.
                All sessions listed above have been verified as completed through the platform.
              </p>
              <p style={{ margin: '6px 0 0', fontSize: 11, color: 'var(--text-muted)' }}>
                Report generated: {new Date().toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })}
              </p>
            </div>
          </div>
        </div>
      )}

      {!report && !loading && (
        <div className="card" style={{ textAlign: 'center', padding: 32 }}>
          <div style={{ fontSize: 48, marginBottom: 12 }}>📊</div>
          <h3 style={{ margin: '0 0 8px', color: 'var(--text-primary)' }}>Generate Your Hour Report</h3>
          <p style={{ color: 'var(--text-tertiary)', fontSize: 13, margin: 0, maxWidth: 400, marginLeft: 'auto', marginRight: 'auto' }}>
            Select a date range above and click "Generate Report" to see your verified care hours.
            You can then print it as a PDF or email it directly to your school.
          </p>
        </div>
      )}
    </div>
  );
};
