// ─── Get the app first (v1.134.0) ───
//
// Pete, 11/18, after onboarding a caregiver on her Samsung: she opened the sign-up link in
// Chrome, did the whole signup there, then downloaded the app and was asked for it all again.
// "What about prompting them to download the app before they start the whole process. Like,
// we can at least put the google play link to download the app there because it's public. And
// from that point, when they click an email link it should open the app not chrome."
//
// So: on an Android phone, in a browser (not already in the app), the very first screen of an
// invite or sign-up says get the app, then tap the same link again. The new Android build
// claims yourinplace.com links (App Links), so the second tap opens the app on the same
// invite. iPhone gets nothing yet: the App Store listing is not public.
//
// It never blocks. "Continue here instead" keeps the old path, remembered for this tab.

const PLAY_STORE_URL = window.PLAY_STORE_URL = 'https://play.google.com/store/apps/details?id=com.yourinplace.app';

const shouldOfferAndroidApp = window.shouldOfferAndroidApp = () => {
  try {
    if (window.Capacitor && window.Capacitor.isNativePlatform && window.Capacitor.isNativePlatform()) return false;
    if (!/Android/i.test(navigator.userAgent || '')) return false;
    if (sessionStorage.getItem('inplace:continueInBrowser') === '1') return false;
    return true;
  } catch (e) { return false; }
};

const GetTheAppFirst = window.GetTheAppFirst = ({ style }) => {
  const [show, setShow] = React.useState(() => shouldOfferAndroidApp());
  if (!show) return null;
  const keepGoing = () => {
    try { sessionStorage.setItem('inplace:continueInBrowser', '1'); } catch (e) { /* this tap only */ }
    setShow(false);
  };
  return (
    <div data-testid="get-the-app-first" style={{
      background: 'var(--bg-surface)', border: '2px solid var(--role-color, #1b6b5a)', borderRadius: 14,
      padding: '18px 18px 14px', marginBottom: 16, ...(style || {}),
    }}>
      <div style={{ fontSize: 18, fontWeight: 700, color: 'var(--text-primary)', marginBottom: 6 }}>
        Get the InPlace app first
      </div>
      <ol style={{ margin: '0 0 14px', paddingLeft: 20, fontSize: 15, lineHeight: 1.5, color: 'var(--text-secondary)' }}>
        <li>Install InPlace Care from Google Play.</li>
        <li>Come back to this email or text and tap the same link again. It will open in the app, and everything you enter stays with you.</li>
      </ol>
      <a href={PLAY_STORE_URL} target="_blank" rel="noopener noreferrer" style={{
        display: 'block', textAlign: 'center', padding: '13px 16px', borderRadius: 10, fontSize: 16, fontWeight: 700,
        background: 'var(--role-color, #1b6b5a)', color: 'var(--text-on-primary, #fff)', textDecoration: 'none',
      }}>Get it on Google Play</a>
      <button type="button" onClick={keepGoing} style={{
        display: 'block', width: '100%', marginTop: 8, padding: '10px', background: 'none', border: 'none',
        color: 'var(--text-secondary)', fontSize: 14, cursor: 'pointer', textDecoration: 'underline',
      }}>Continue here instead</button>
    </div>
  );
};
