// Cloudflare Worker - MilkChoco トークン販売サイト（3プラン対応版・修正済み）

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const corsHeaders = {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
    };

    if (request.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });

    if (url.pathname === '/' || url.pathname === '/index.html') {
      return new Response(getSalesPageHTML(env), { headers: { 'Content-Type': 'text/html; charset=utf-8' } });
    }
    if (url.pathname === '/api/create-checkout' && request.method === 'POST') {
      return await createCheckoutSession(request, env, corsHeaders);
    }
    if (url.pathname === '/api/fulfill' && request.method === 'POST') {
      return await fulfillOrder(request, env, corsHeaders);
    }
    return new Response('Not Found', { status: 404 });
  },
};

// ============================================================
// Stripe Checkout Session 作成
// ============================================================
async function createCheckoutSession(request, env, corsHeaders) {
  try {
    const body = await request.json();
    const { priceId } = body;

    if (!priceId) return new Response(JSON.stringify({ error: 'Price ID is required' }), { status: 400, headers: { 'Content-Type': 'application/json', ...corsHeaders } });

    const stripeResponse = await fetch('https://api.stripe.com/v1/checkout/sessions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${env.STRIPE_SECRET_KEY}`,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams({
        'mode': 'payment',
        'payment_method_types[0]': 'card',
        'line_items[0][price]': priceId,
        'line_items[0][quantity]': '1',
        'success_url': `${new URL(request.url).origin}/success?session_id={CHECKOUT_SESSION_ID}`,
        'cancel_url': `${new URL(request.url).origin}/cancel`,
        'metadata[priceId]': priceId,
      }),
    });

    const session = await stripeResponse.json();
    if (!stripeResponse.ok) throw new Error(session.error?.message || 'Stripe error');

    return new Response(JSON.stringify({ url: session.url }), { headers: { 'Content-Type': 'application/json', ...corsHeaders } });
  } catch (err) {
    console.error('Checkout creation failed:', err);
    return new Response(JSON.stringify({ error: 'Internal error' }), { status: 500, headers: { 'Content-Type': 'application/json', ...corsHeaders } });
  }
}

// ============================================================
// 決済完了後のトークン発行
// ============================================================
async function fulfillOrder(request, env, corsHeaders) {
  try {
    const { sessionId } = await request.json();

    const stripeResponse = await fetch(`https://api.stripe.com/v1/checkout/sessions/${sessionId}`, {
      headers: { 'Authorization': `Bearer ${env.STRIPE_SECRET_KEY}` },
    });
    const session = await stripeResponse.json();

    if (!stripeResponse.ok || session.payment_status !== 'paid') {
      return new Response(JSON.stringify({ error: 'Payment not completed' }), { status: 400, headers: { 'Content-Type': 'application/json', ...corsHeaders } });
    }

    const priceId = session.metadata?.priceId;
    let uses, expires;

    if (priceId === env.STRIPE_PRICE_ID_500) {
      uses = 50;
      expires = getFutureDate(30);
    } else if (priceId === env.STRIPE_PRICE_ID_1000) {
      uses = 150;
      expires = getFutureDate(30);
    } else if (priceId === env.STRIPE_PRICE_ID_1500) {
      uses = 1000000;
      expires = '2090-12-31';
    } else {
      return new Response(JSON.stringify({ error: 'Unknown price ID' }), { status: 400, headers: { 'Content-Type': 'application/json', ...corsHeaders } });
    }

    const token = await issueTokenOnRender(env, session, uses, expires);

    return new Response(JSON.stringify({ success: true, token, message: 'トークンを発行しました。' }), {
      headers: { 'Content-Type': 'application/json', ...corsHeaders },
    });
  } catch (err) {
    console.error('Fulfillment failed:', err);
    return new Response(JSON.stringify({ error: 'Fulfillment error' }), { status: 500, headers: { 'Content-Type': 'application/json', ...corsHeaders } });
  }
}

// ============================================================
// Render.com の管理APIを呼び出す
// ============================================================
async function issueTokenOnRender(env, session, uses, expires) {
  const response = await fetch(`${env.TOKEN_SERVER_URL}/api/admin/issue`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Admin-Password': env.ADMIN_API_PASSWORD,
    },
    body: JSON.stringify({
      user: session.customer_email || 'customer',
      version: '1.0',
      uses: uses,
      expires: expires,
      orderId: session.id,
    }),
  });

  const data = await response.json();
  if (!response.ok) throw new Error(data.error || 'Token issue failed');
  return data.token;
}

// ============================================================
// ユーティリティ
// ============================================================
function getFutureDate(days) {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return d.toISOString().split('T')[0];
}

// ============================================================
// 販売ページHTML（3プラン対応・env受け取り版）
// ============================================================
function getSalesPageHTML(env) {
  const price500 = env.STRIPE_PRICE_ID_500 || 'PRICE_500_NOT_SET';
  const price1000 = env.STRIPE_PRICE_ID_1000 || 'PRICE_1000_NOT_SET';
  const price1500 = env.STRIPE_PRICE_ID_1500 || 'PRICE_1500_NOT_SET';

  return `<!DOCTYPE html>
<html lang="ja">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>MilkChoco トークン販売</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); min-height: 100vh; display: flex; align-items: center; justify-content: center; padding: 20px; }
    .container { max-width: 900px; width: 100%; }
    h1 { text-align: center; color: white; margin-bottom: 30px; font-size: 32px; text-shadow: 0 2px 10px rgba(0,0,0,0.2); }
    .plans { display: grid; grid-template-columns: repeat(auto-fit, minmax(250px, 1fr)); gap: 20px; }
    .card { background: white; border-radius: 20px; padding: 30px; text-align: center; box-shadow: 0 10px 40px rgba(0,0,0,0.15); transition: transform 0.2s; position: relative; }
    .card:hover { transform: translateY(-5px); }
    .card.popular { border: 3px solid #667eea; }
    .badge { position: absolute; top: -12px; left: 50%; transform: translateX(-50%); background: #667eea; color: white; padding: 4px 12px; border-radius: 20px; font-size: 12px; font-weight: bold; }
    .plan-name { font-size: 18px; color: #666; margin-bottom: 10px; }
    .price { font-size: 40px; font-weight: bold; color: #333; margin: 15px 0; }
    .features { list-style: none; margin: 20px 0; padding: 0; text-align: left; }
    .features li { padding: 8px 0; font-size: 14px; color: #555; border-bottom: 1px solid #eee; }
    .features li:last-child { border-bottom: none; }
    .check { color: #4CAF50; margin-right: 8px; }
    .pay-btn { width: 100%; padding: 14px; background: #000; color: white; border: none; border-radius: 10px; font-size: 16px; font-weight: bold; cursor: pointer; transition: opacity 0.2s; margin-top: 10px; }
    .pay-btn:hover { opacity: 0.8; }
    .pay-btn:disabled { opacity: 0.5; cursor: not-allowed; }
    .note { text-align: center; font-size: 12px; color: rgba(255,255,255,0.8); margin-top: 20px; }
    .gp-hint { text-align: center; font-size: 13px; color: #000; margin-top: 8px; }
    @media (max-width: 600px) { .plans { grid-template-columns: 1fr; } }
  </style>
</head>
<body>
  <div class="container">
    <h1>🥛 MilkChoco トークン</h1>
    <div class="plans">
      <div class="card">
        <div class="plan-name">お試しプラン</div>
        <div class="price">¥500</div>
        <ul class="features">
          <li><span class="check">✓</span> <b>50回分の</b>使用権</li>
          <li><span class="check">✓</span> 発行から30日間有効</li>
          <li><span class="check">✓</span> 1端末のみで使用可能</li>
        </ul>
        <button class="pay-btn" onclick="startPayment('${price500}')">購入する</button>
      </div>

      <div class="card popular">
        <div class="badge">人気</div>
        <div class="plan-name">スタンダードプラン</div>
        <div class="price">¥1,000</div>
        <ul class="features">
          <li><span class="check">✓</span> <b>150回分</b>の使用権</li>
          <li><span class="check">✓</span> 発行から30日間有効</li>
          <li><span class="check">✓</span> 1端末のみで使用可能</li>
        </ul>
        <button class="pay-btn" onclick="startPayment('${price1000}')">購入する</button>
      </div>

      <div class="card">
        <div class="plan-name">プレミアムプラン</div>
        <div class="price">¥1,500</div>
        <ul class="features">
          <li><span class="check">✓</span> <b>無制限</b></li>
          <li><span class="check">✓</span> <b>期限なし</b></li>
          <li><span class="check">✓</span> 1端末のみで使用可能</li>
        </ul>
        <button class="pay-btn" onclick="startPayment('${price1500}')">購入する</button>
      </div>
    </div>
    <p class="gp-hint">💳 カード、Apple Pay、Google Payがご利用いただけます</p>
    <p class="note">決済はStripeにより安全に処理されます</p>
  </div>

  <script>
    async function startPayment(priceId) {
      if (!priceId || priceId.includes('NOT_SET')) {
        alert('StripeのPrice IDが設定されていません。管理画面を確認してください。');
        return;
      }
      const btn = event.target;
      btn.disabled = true;
      btn.textContent = '処理中...';
      try {
        const res = await fetch('/api/create-checkout', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ priceId }),
        });
        const data = await res.json();
        if (data.url) window.location.href = data.url;
        else { alert('エラー: ' + (data.error || '決済を開始できませんでした')); btn.disabled = false; btn.textContent = '購入する'; }
      } catch (err) { alert('通信エラー'); btn.disabled = false; btn.textContent = '購入する'; }
    }

    const params = new URLSearchParams(window.location.search);
    const sessionId = params.get('session_id');
    if (sessionId && window.location.pathname === '/success') {
      document.body.innerHTML = '<div class="card" style="max-width:480px;margin:40px auto;"><h2 style="text-align:center;">✅ 決済完了</h2><p style="text-align:center;margin:20px 0;">トークンを発行しています...</p></div>';
      fetch('/api/fulfill', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sessionId }),
      }).then(r => r.json()).then(data => {
        if (data.success) {
          document.body.innerHTML = \`<div class="card" style="max-width:480px;margin:40px auto;"><h2 style="text-align:center;">🎉 購入完了！</h2><p style="text-align:center;margin:16px 0;color:#666;">あなたのトークン：</p><div style="background:#f5f5f5;padding:20px;border-radius:12px;text-align:center;"><code style="font-size:20px;font-weight:bold;color:#667eea;word-break:break-all;">\${data.token}</code></div><p style="text-align:center;margin-top:20px;font-size:14px;color:#888;">このトークンをゲーム内で入力してください</p></div>\`;
        } else {
          document.body.innerHTML = '<div class="card" style="max-width:480px;margin:40px auto;"><h2 style="text-align:center;">⚠️ エラー</h2><p style="text-align:center;color:red;">' + (data.error || 'トークン発行に失敗しました') + '</p></div>';
        }
      });
    }
  </script>
</body>
</html>`;
}
