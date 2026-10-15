// Cloudflare Worker - MilkChoco トークン販売サイト

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    // CORS対応（必要に応じて）
    const corsHeaders = {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
    };

    if (request.method === 'OPTIONS') {
      return new Response(null, { headers: corsHeaders });
    }

    // --- ルーティング ---
    if (url.pathname === '/' || url.pathname === '/index.html') {
      return new Response(getSalesPageHTML(env), {
        headers: { 'Content-Type': 'text/html; charset=utf-8' },
      });
    }

    // Stripe Checkout Session 作成
    if (url.pathname === '/api/create-checkout' && request.method === 'POST') {
      return await createCheckoutSession(request, env, corsHeaders);
    }

    // 決済完了後のトークン発行
    if (url.pathname === '/api/fulfill' && request.method === 'POST') {
      return await fulfillOrder(request, env, corsHeaders);
    }

    // Stripe Webhook（推奨：非同期でトークン発行する場合）
    if (url.pathname === '/stripe-webhook' && request.method === 'POST') {
      return await handleStripeWebhook(request, env);
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
    const { email, userNote } = body;

    // Stripe API で Checkout Session を作成
    const stripeResponse = await fetch('https://api.stripe.com/v1/checkout/sessions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${env.STRIPE_SECRET_KEY}`,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams({
        'mode': 'payment',
        'payment_method_types[0]': 'card',  // Apple Pay は card に含まれる
        'line_items[0][price]': env.STRIPE_PRICE_ID,
        'line_items[0][quantity]': '1',
        'success_url': `${new URL(request.url).origin}/success?session_id={CHECKOUT_SESSION_ID}`,
        'cancel_url': `${new URL(request.url).origin}/cancel`,
        'customer_email': email || undefined,
        'client_reference_id': generateOrderId(),
        'metadata[userNote]': userNote || '',
      }),
    });

    const session = await stripeResponse.json();

    if (!stripeResponse.ok) {
      console.error('Stripe Error:', session);
      return new Response(JSON.stringify({ error: session.error?.message || 'Stripe error' }), {
        status: 500,
        headers: { 'Content-Type': 'application/json', ...corsHeaders },
      });
    }

    return new Response(JSON.stringify({
      url: session.url,
      sessionId: session.id,
      clientReferenceId: session.client_reference_id,
    }), {
      headers: { 'Content-Type': 'application/json', ...corsHeaders },
    });

  } catch (err) {
    console.error('Checkout creation failed:', err);
    return new Response(JSON.stringify({ error: 'Internal error' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json', ...corsHeaders },
    });
  }
}

// ============================================================
// 決済完了後のトークン発行
// ============================================================
async function fulfillOrder(request, env, corsHeaders) {
  try {
    const body = await request.json();
    const { sessionId } = body;

    // 1. Stripe Session を検証
    const stripeResponse = await fetch(
      `https://api.stripe.com/v1/checkout/sessions/${sessionId}`,
      {
        headers: {
          'Authorization': `Bearer ${env.STRIPE_SECRET_KEY}`,
        },
      }
    );
    const session = await stripeResponse.json();

    if (!stripeResponse.ok) {
      return new Response(JSON.stringify({ error: 'Invalid session' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json', ...corsHeaders },
      });
    }

    // 決済が完了しているか確認
    if (session.payment_status !== 'paid') {
      return new Response(JSON.stringify({ error: 'Payment not completed' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json', ...corsHeaders },
      });
    }

    // 2. Render.com の管理APIでトークンを発行
    const token = await issueTokenOnRender(env, session);

    return new Response(JSON.stringify({
      success: true,
      token: token,
      message: 'トークンを発行しました。ゲーム内で使用してください。',
    }), {
      headers: { 'Content-Type': 'application/json', ...corsHeaders },
    });

  } catch (err) {
    console.error('Fulfillment failed:', err);
    return new Response(JSON.stringify({ error: 'Fulfillment error' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json', ...corsHeaders },
    });
  }
}

// ============================================================
// Render.com の管理APIを呼び出してトークンを発行
// ============================================================
async function issueTokenOnRender(env, session) {
  // Render側の管理画面はフォームベースなので、
  // トークン発行用のAPIエンドポイントを別途追加する必要があります。
  // 以下はその想定コードです（server.js に /api/admin/issue を追加）。
  const response = await fetch(`${env.TOKEN_SERVER_URL}/api/admin/issue`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Admin-Password': env.ADMIN_API_PASSWORD,
    },
    body: JSON.stringify({
      user: session.customer_email || session.metadata?.userNote || 'customer',
      version: '1.0',
      uses: 10,
      expires: getFutureDate(30), // 30日後
      orderId: session.client_reference_id,
    }),
  });

  const data = await response.json();
  if (!response.ok) {
    throw new Error(data.error || 'Token issue failed');
  }
  return data.token;
}

// ============================================================
// ユーティリティ
// ============================================================
function generateOrderId() {
  return 'order_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9);
}

function getFutureDate(days) {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return d.toISOString().split('T')[0];
}

// ============================================================
// 販売ページHTML
// ============================================================
function getSalesPageHTML(env) {
  return `<!DOCTYPE html>
<html lang="ja">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>MilkChoco トークン販売</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
      min-height: 100vh;
      display: flex;
      align-items: center;
      justify-content: center;
      padding: 20px;
    }
    .card {
      background: white;
      border-radius: 24px;
      padding: 40px;
      max-width: 480px;
      width: 100%;
      box-shadow: 0 20px 60px rgba(0,0,0,0.3);
    }
    h1 { text-align: center; margin-bottom: 8px; font-size: 28px; }
    .subtitle { text-align: center; color: #888; margin-bottom: 30px; font-size: 14px; }
    .price {
      text-align: center;
      font-size: 48px;
      font-weight: bold;
      color: #667eea;
      margin: 20px 0;
    }
    .price span { font-size: 20px; color: #888; font-weight: normal; }
    .features {
      list-style: none;
      margin: 24px 0;
      padding: 0;
    }
    .features li {
      padding: 12px 0;
      border-bottom: 1px solid #eee;
      display: flex;
      align-items: center;
      gap: 10px;
      font-size: 15px;
    }
    .features li:last-child { border-bottom: none; }
    .check { color: #4CAF50; font-weight: bold; }
    .pay-btn {
      width: 100%;
      padding: 16px;
      background: #000;
      color: white;
      border: none;
      border-radius: 12px;
      font-size: 18px;
      font-weight: bold;
      cursor: pointer;
      transition: opacity 0.2s;
      display: flex;
      align-items: center;
      justify-content: center;
      gap: 8px;
    }
    .pay-btn:hover { opacity: 0.85; }
    .pay-btn:disabled { opacity: 0.5; cursor: not-allowed; }
    .note { text-align: center; font-size: 12px; color: #aaa; margin-top: 16px; }
    .apple-pay-hint { text-align: center; font-size: 13px; color: #666; margin-top: 8px; }
  </style>
</head>
<body>
  <div class="card">
    <h1>🥛 MilkChoco</h1>
    <p class="subtitle">トークン購入</p>

    <div class="price">¥500 <span>/ 10回分</span></div>

    <ul class="features">
      <li><span class="check">✓</span> 10回分の使用権</li>
      <li><span class="check">✓</span> 発行から30日間有効</li>
      <li><span class="check">✓</span> 1端末のみで使用可能</li>
      <li><span class="check">✓</span> 購入後すぐにトークン発行</li>
    </ul>

    <button class="pay-btn" id="payBtn" onclick="startPayment()">
      💳 カード・Apple Payで支払う
    </button>
    <p class="apple-pay-hint">※ Apple Pay対応デバイスではApple Payが表示されます</p>
    <p class="note">決済はStripeにより安全に処理されます</p>
  </div>

  <script>
    async function startPayment() {
      const btn = document.getElementById('payBtn');
      btn.disabled = true;
      btn.textContent = '処理中...';

      try {
        const res = await fetch('/api/create-checkout', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({}),
        });
        const data = await res.json();

        if (data.url) {
          window.location.href = data.url;
        } else {
          alert('エラー: ' + (data.error || '決済を開始できませんでした'));
          btn.disabled = false;
          btn.textContent = '💳 カード・Apple Payで支払う';
        }
      } catch (err) {
        alert('通信エラーが発生しました');
        btn.disabled = false;
        btn.textContent = '💳 カード・Apple Payで支払う';
      }
    }

    // 決済完了後のトークン表示
    const params = new URLSearchParams(window.location.search);
    const sessionId = params.get('session_id');
    if (sessionId && window.location.pathname === '/success') {
      document.body.innerHTML = '<div class="card"><h1>✅ 決済完了</h1><p style="text-align:center;margin:20px 0;">トークンを発行しています...</p></div>';
      fetch('/api/fulfill', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sessionId }),
      })
        .then(r => r.json())
        .then(data => {
          if (data.success) {
            document.body.innerHTML = \`
              <div class="card">
                <h1>🎉 購入完了！</h1>
                <p style="text-align:center;margin:16px 0;color:#666;">あなたのトークン：</p>
                <div style="background:#f5f5f5;padding:20px;border-radius:12px;text-align:center;">
                  <code style="font-size:20px;font-weight:bold;color:#667eea;word-break:break-all;">\${data.token}</code>
                </div>
                <p style="text-align:center;margin-top:20px;font-size:14px;color:#888;">このトークンをゲーム内で入力してください</p>
              </div>\`;
          } else {
            document.body.innerHTML = '<div class="card"><h1>⚠️ エラー</h1><p style="text-align:center;color:red;">' + (data.error || 'トークン発行に失敗しました') + '</p></div>';
          }
        });
    }
  </script>
</body>
</html>`;
}
