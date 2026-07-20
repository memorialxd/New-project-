import { Printer } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { escapeHtml } from '@/lib/escape-html';
import type { OrderWithItems } from '@/hooks/useOrders';

export function printOrderTicket(order: OrderWithItems, storeName: string) {
  const win = window.open('', 'PRINT', 'height=700,width=400');
  if (!win) return;
  const e = escapeHtml;
  const itemsHtml = (order.order_items ?? [])
    .map(
      (i) => `
        <tr>
          <td style="padding:4px 0;font-weight:600;">${i.quantity}×</td>
          <td style="padding:4px 6px;">${e(String(i.name ?? ''))}</td>
          <td style="padding:4px 0;text-align:right;">€${(Number(i.unit_price) * i.quantity).toFixed(2)}</td>
        </tr>`,
    )
    .join('');
  const html = `
    <!doctype html>
    <html>
    <head>
      <title>Παραγγελία #${order.id.slice(0, 6)}</title>
      <meta charset="utf-8" />
      <style>
        @page { size: 80mm auto; margin: 4mm; }
        body { font-family: -apple-system, system-ui, sans-serif; color:#000; padding:8px; max-width:280px; margin:0 auto; }
        h1 { font-size:18px; margin:0 0 4px; text-align:center; }
        .muted { color:#555; font-size:11px; }
        .center { text-align:center; }
        .order-id { font-family: monospace; font-size: 14px; font-weight:bold; text-align:center; margin: 8px 0; padding: 6px; background:#f0f0f0; border-radius:4px;}
        table { width:100%; border-collapse:collapse; font-size:13px; margin-top:6px; }
        td { vertical-align: top; }
        hr { border:none; border-top:1px dashed #999; margin:8px 0; }
        .totals td { padding: 2px 0; font-size:13px; }
        .grand { font-weight:bold; font-size:16px; border-top:2px solid #000; padding-top:6px !important; }
        .notes { background:#fff8e1; padding:6px; border-radius:4px; font-size:12px; margin-top:6px; }
        .qr { margin-top: 12px; text-align:center; font-size:10px; color:#666; }
      </style>
    </head>
    <body>
      <h1>${e(String(storeName ?? ''))}</h1>
      <div class="center muted">${new Date(order.created_at).toLocaleString('el-GR')}</div>
      <div class="order-id">#${order.id.slice(0, 8).toUpperCase()}</div>
      <hr/>
      <table><tbody>${itemsHtml}</tbody></table>
      <hr/>
      <table class="totals">
        <tr><td>Υποσύνολο</td><td style="text-align:right">€${(Number(order.total_amount) - Number(order.delivery_fee ?? 0) - Number(order.tip_amount ?? 0)).toFixed(2)}</td></tr>
        ${order.delivery_fee ? `<tr><td>Παράδοση</td><td style="text-align:right">€${Number(order.delivery_fee).toFixed(2)}</td></tr>` : ''}
        ${order.tip_amount ? `<tr><td>Φιλοδώρημα</td><td style="text-align:right">€${Number(order.tip_amount).toFixed(2)}</td></tr>` : ''}
        <tr class="grand"><td>ΣΥΝΟΛΟ</td><td style="text-align:right">€${Number(order.total_amount).toFixed(2)}</td></tr>
      </table>
      ${order.notes ? `<div class="notes"><strong>Σημείωση:</strong> ${e(String(order.notes))}</div>` : ''}
      ${order.delivery_address ? `<hr/><div class="muted"><strong>Παράδοση:</strong><br/>${e(String(order.delivery_address))}</div>` : ''}
      <div class="qr">— Ευχαριστούμε —</div>
      <script>window.onload=()=>{window.print();setTimeout(()=>window.close(),200);}</script>
    </body>
    </html>
  `;
  win.document.write(html);
  win.document.close();
}

export function PrintTicketButton({ order, storeName }: { order: OrderWithItems; storeName: string }) {
  return (
    <Button
      type="button"
      variant="outline"
      size="sm"
      onClick={(e) => {
        e.stopPropagation();
        printOrderTicket(order, storeName);
      }}
      className="h-8 text-xs"
    >
      <Printer className="h-3.5 w-3.5 mr-1" />
      Εκτύπωση
    </Button>
  );
}
