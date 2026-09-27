import { DEMO_BANNER } from "../demo";

export function Login() {
  return (
    <div className="login">
      <div className="login-brand">
        <div className="login-mark">
          <span className="brand-mark">TZ</span>
          <span className="brand-name">TechZoid CRM</span>
        </div>
        <div>
          <div className="login-head">Every lead, followed up. Without being chased.</div>
          <ul className="login-points">
            <li className="login-point"><span className="login-tick">✓</span><span>Leads assigned, scored and given a first task the moment they arrive</span></li>
            <li className="login-point"><span className="login-tick">✓</span><span>Follow-ups created after every call — nothing left to remember</span></li>
            <li className="login-point"><span className="login-tick">✓</span><span>Overdue work escalated to managers automatically</span></li>
            <li className="login-point"><span className="login-tick">✓</span><span>Pipeline, forecast and team performance, live</span></li>
          </ul>
        </div>
        <div className="login-foot">{DEMO_BANNER}</div>
      </div>
      <div className="login-form">
        <div className="login-card">
          <div className="login-title">Sign in</div>
          <div className="login-sub">Use your work account.</div>
          <div className="lf">
            <div className="lf-label">Work email</div>
            <input className="lf-input" defaultValue="priyanshi.sharma@techzoid.example" readOnly />
          </div>
          <div className="lf">
            <div className="lf-label">Password</div>
            <input className="lf-input" type="password" defaultValue="............" readOnly />
          </div>
          <button className="lf-btn">Sign in</button>
          <button className="lf-alt">Continue with Microsoft 365</button>
          <div className="lf-note">Trouble signing in? Ask your administrator to reset access.</div>
        </div>
      </div>
    </div>
  );
}
