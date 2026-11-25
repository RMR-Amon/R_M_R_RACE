import { useMemo, useState } from 'react';
import { qrMatrix } from '../../net/qr';
import { t } from '../../i18n';

/** clipboard API needs a secure context — on http://192.168.x.x the classic way still works */
async function copyText(text: string): Promise<boolean> {
  try {
    if (window.isSecureContext && navigator.clipboard) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    /* fall through */
  }
  const el = document.createElement('textarea');
  el.value = text;
  el.setAttribute('readonly', '');
  // must be selectable although the page disables selection
  el.style.cssText = 'position:fixed;left:0;top:0;opacity:0;user-select:text;-webkit-user-select:text';
  document.body.appendChild(el);
  el.focus();
  el.select();
  el.setSelectionRange(0, text.length);
  let ok = false;
  try {
    ok = document.execCommand('copy');
  } catch {
    ok = false;
  }
  el.remove();
  return ok;
}

function QrCode({ text }: { text: string }) {
  const m = useMemo(() => qrMatrix(text), [text]);
  if (!m) return null;
  const q = 4;
  const n = m.length + q * 2;
  let d = '';
  m.forEach((row, r) => row.forEach((on, c) => on && (d += `M${c + q} ${r + q}h1v1h-1z`)));
  return (
    <svg viewBox={`0 0 ${n} ${n}`} className="h-auto w-full max-w-[220px] rounded-2xl bg-white" shapeRendering="crispEdges" role="img" aria-label={text}>
      <path d={d} fill="#000" />
    </svg>
  );
}

/** the address players open in their browser: big, copyable, with a QR code for phones */
export function LanAddress({ address }: { address: string }) {
  const url = `http://${address}`;
  const [copied, setCopied] = useState<'no' | 'yes' | 'failed'>('no');
  const [qr, setQr] = useState(false);
  const copy = async () => {
    setCopied((await copyText(url)) ? 'yes' : 'failed');
    window.setTimeout(() => setCopied('no'), 2000);
  };
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <code className="select-text break-all rounded-2xl bg-black/35 px-3 py-2 font-mono text-base text-sky-200 ring-1 ring-sky-300/30 sm:text-lg">{url}</code>
        <button onClick={() => void copy()} className="btn-ghost !px-3 !py-2 text-xs sm:text-sm">
          {copied === 'yes' ? `✓ ${t('mp.copied')}` : copied === 'failed' ? t('mp.copyFailed') : `📋 ${t('mp.copy')}`}
        </button>
        <button onClick={() => setQr((v) => !v)} className="btn-ghost !px-3 !py-2 text-xs sm:text-sm" aria-expanded={qr}>
          📱 {qr ? t('mp.qrHide') : t('mp.qr')}
        </button>
      </div>
      {qr && (
        <div className="animate-slideUp">
          <QrCode text={`${url}/`} />
          <p className="mt-2 max-w-xs text-xs text-white/55">{t('mp.qrHint')}</p>
        </div>
      )}
    </div>
  );
}
