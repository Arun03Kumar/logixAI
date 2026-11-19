"use client";
import { useEffect, useState } from "react";
import QRCode from "qrcode";
import { Download, Printer, X } from "lucide-react";
import { Button, Card, Skeleton } from "@logixai/ui";
import { ROLE_LABEL } from "../../labels";

/**
 * A QR code for an invite link, to project in class or print on a notice:
 * students scan it, sign in and join.
 */
export default function InviteQr({ invite, institutionName, batchName, onClose }) {
  const link = `${window.location.origin}/join/${invite.code}`;
  const [svg, setSvg] = useState(null);
  const [png, setPng] = useState(null);

  useEffect(() => {
    let live = true;
    const opts = { errorCorrectionLevel: "M", margin: 1 };
    Promise.all([QRCode.toString(link, { ...opts, type: "svg" }), QRCode.toDataURL(link, { ...opts, width: 1024 })]).then(([s, p]) => {
      if (!live) return;
      setSvg(s);
      setPng(p);
    });
    return () => {
      live = false;
    };
  }, [link]);

  const print = () => {
    const w = window.open("", "_blank", "width=720,height=900");
    if (!w) return;
    const esc = (t) => String(t).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
    w.document.write(`<!doctype html><html><head><meta charset="utf-8"><title>Join ${esc(institutionName)}</title>
<style>body{font-family:system-ui,sans-serif;text-align:center;padding:48px;color:#111}h1{font-size:28px;margin:0 0 8px}
p{font-size:18px;margin:6px 0}img{width:420px;height:420px;margin:24px auto;display:block}.code{font:600 32px ui-monospace,monospace;letter-spacing:2px}</style>
</head><body><h1>Join ${esc(institutionName)}</h1><p>${esc(ROLE_LABEL[invite.role])}${batchName ? ` · ${esc(batchName)}` : ""}</p>
<img src="${png}" alt="QR code"><p>Scan with your phone camera, or go to</p><p><strong>${esc(link)}</strong></p>
<p>Invite code</p><p class="code">${esc(invite.code)}</p></body></html>`);
    w.document.close();
    w.onload = () => w.print();
  };

  return (
    <Card className="border-primary/40 p-5">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h2 className="text-sm font-semibold">QR code for {invite.code}</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Show it on the projector or print it. Students scan it with their phone camera, sign in and join
            {batchName ? ` ${batchName}` : ""}.
          </p>
        </div>
        <Button variant="ghost" size="icon-sm" aria-label="Close QR code" onClick={onClose}>
          <X />
        </Button>
      </div>
      <div className="mt-4 flex flex-col items-center gap-4 sm:flex-row sm:items-start">
        {svg ? (
          // The SVG comes from the qrcode library for our own link, not from user input.
          <div className="size-52 shrink-0 rounded-lg bg-white p-2" dangerouslySetInnerHTML={{ __html: svg }} />
        ) : (
          <Skeleton className="size-52 shrink-0" />
        )}
        <div className="space-y-3 text-sm">
          <p className="break-all font-mono text-xs text-muted-foreground">{link}</p>
          <div className="flex flex-wrap gap-2">
            <Button size="sm" variant="outline" disabled={!png} onClick={print}>
              <Printer />
              Print poster
            </Button>
            <Button asChild size="sm" variant="ghost">
              <a href={png ?? undefined} download={`invite-${invite.code}.png`} aria-disabled={!png}>
                <Download />
                Download image
              </a>
            </Button>
          </div>
        </div>
      </div>
    </Card>
  );
}
