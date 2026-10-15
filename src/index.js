// Cloudflare Worker - Nexa トークン販売サイト（スマホ対応・背景パララックス修正版）

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
// 販売ページHTML（背景パララックス・黒背景・Discordリンク対応版）
// ============================================================
function getSalesPageHTML(env) {
  const price500 = env.STRIPE_PRICE_ID_500 || 'PRICE_500_NOT_SET';
  const price1000 = env.STRIPE_PRICE_ID_1000 || 'PRICE_1000_NOT_SET';
  const price1500 = env.STRIPE_PRICE_ID_1500 || 'PRICE_1500_NOT_SET';
  const bgImage = 'https://raw.githubusercontent.com/milkchocoploplo-web/NexaShop/main/IMG_9788.jpeg';

  return `<!DOCTYPE html>
<html lang="ja">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Nexa トークン販売</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    
    /* 背景全体の設定 */
    body { 
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; 
      background: #000000; 
      min-height: 100vh; 
      color: #ffffff; 
      overflow-x: hidden;
    }

    /* パララックス用の背景レイヤー（CSS背景画像に変更） */
    .bg-layer {
      position: fixed;
      top: 0;
      left: 0;
      width: 100%;
      height: 120vh; /* スクロールで動く分、長めに確保 */
      z-index: -1;
      background-image: url('${bgImage}');
      background-size: cover;
      background-position: center center;
      background-repeat: no-repeat;
      will-change: transform;
    }

    /* 背景の上にかぶせる黒いグラデーション（文字を読みやすくする） */
    .bg-layer::after {
      content: '';
      position: absolute;
      top: 0;
      left: 0;
      width: 100%;
      height: 100%;
      background: linear-gradient(to bottom, rgba(0,0,0,0.5) 0%, rgba(0,0,0,0.85) 40%, #000000 80%);
    }

    /* メインコンテンツ */
    .container { 
      max-width: 900px; 
      width: 100%; 
      margin: 0 auto; 
      padding: 20px;
      padding-top: 45vh; /* 最初は画像を見せて、下にスクロールするとコンテンツが出てくる */
      position: relative;
      z-index: 1;
    }
    
    h1 { text-align: center; color: #ffffff; margin-bottom: 20px; font-size: 32px; text-shadow: 0 0 10px rgba(255,255,255,0.3); }
    .plans { display: grid; grid-template-columns: repeat(auto-fit, minmax(250px, 1fr)); gap: 20px; }
    
    /* カードのデザイン */
    .card { background: rgba(17, 17, 17, 0.8); backdrop-filter: blur(10px); border: 1px solid #333; border-radius: 20px; padding: 30px; text-align: center; box-shadow: 0 10px 40px rgba(0,0,0,0.8); transition: transform 0.2s, border-color 0.2s; position: relative; }
    .card:hover { transform: translateY(-5px); border-color: #5865F2; }
    .card.popular { border: 2px solid #5865F2; }
    
    .badge { position: absolute; top: -12px; left: 50%; transform: translateX(-50%); background: #5865F2; color: white; padding: 4px 12px; border-radius: 20px; font-size: 12px; font-weight: bold; }
    .plan-name { font-size: 18px; color: #aaaaaa; margin-bottom: 10px; }
    .price { font-size: 40px; font-weight: bold; color: #ffffff; margin: 15px 0; }
    
    .features { list-style: none; margin: 20px 0; padding: 0; text-align: left; }
    .features li { padding: 8px 0; font-size: 14px; color: #cccccc; border-bottom: 1px solid #222; }
    .features li:last-child { border-bottom: none; }
    .check { color: #4CAF50; margin-right: 8px; }
    
    .pay-btn { width: 100%; padding: 14px; background: #ffffff; color: #000000; border: none; border-radius: 10px; font-size: 16px; font-weight: bold; cursor: pointer; transition: opacity 0.2s, transform 0.1s; margin-top: 10px; }
    .pay-btn:hover { opacity: 0.8; transform: scale(1.02); }
    .pay-btn:disabled { opacity: 0.5; cursor: not-allowed; }
    
    /* Discordボタン */
    .discord-section { text-align: center; margin-top: 30px; }
    .discord-btn { display: inline-flex; align-items: center; background: #5865F2; color: white; padding: 14px 28px; border-radius: 12px; text-decoration: none; font-weight: bold; font-size: 16px; transition: 0.2s; box-shadow: 0 4px 15px rgba(88, 101, 242, 0.4); }
    .discord-btn:hover { background: #4752C4; transform: translateY(-2px); box-shadow: 0 6px 20px rgba(88, 101, 242, 0.6); }
    .discord-btn svg { margin-right: 8px; width: 20px; height: 20px; fill: currentColor; }
    
    .gp-hint { text-align: center; font-size: 13px; color: #aaaaaa; margin-top: 25px; }
    .note { text-align: center; font-size: 12px; color: #555555; margin-top: 10px; }
    @media (max-width: 600px) { .plans { grid-template-columns: 1fr; } }
  </style>
</head>
<body>
  <!-- 背景レイヤー -->
  <div class="bg-layer" id="parallaxBg"></div>

  <div class="container">
    <h1>Nexa トークン販売</h1>
    <div class="plans">
      <div class="card">
        <div class="plan-name">お試しプラン</div>
        <div class="price">¥500</div>
        <ul class="features">
          <li><span class="check">✓</span> <b>50回分</b>の使用権</li>
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
          <li><span class="check">✓</span> <b>無制限</b>（実質100万回）</li>
          <li><span class="check">✓</span> <b>2090年まで有効</b></li>
          <li><span class="check">✓</span> 1端末のみで使用可能</li>
        </ul>
        <button class="pay-btn" onclick="startPayment('${price1500}')">購入する</button>
      </div>
    </div>
    
    <div class="discord-section">
      <a href="https://discord.gg/jc3mx8N3wT" target="_blank" class="discord-btn">
        <svg viewBox="0 0 24 24"><path d="M20.317 4.3698a19.7913 19.7913 0 00-4.8851-1.5152.0741.0741 0 00-.0785.0371c-.211.3753-.4447.8648-.6083 1.2495-1.8447-.2762-3.68-.2762-5.4868 0-.1636-.3933-.4058-.8742-.6177-1.2495a.077.077 0 00-.0785-.037 19.7363 19.7363 0 00-4.8852 1.515.0699.0699 0 00-.0321.0277C.5334 9.0458-.319 13.5799.0992 18.0578a.0824.0824 0 00.0312.0561c2.0528 1.5076 4.0413 2.4228 5.9929 3.0294a.0777.0777 0 00.0842-.0276c.4616-.6304.8731-1.2952 1.226-1.9942a.076.076 0 00-.0416-.1057c-.6528-.2476-1.2743-.5495-1.8722-.8923a.077.077 0 01-.0076-.1277c.1258-.0943.2517-.1923.3718-.2914a.0743.0743 0 01.0776-.0105c3.9278 1.7933 8.18 1.7933 12.0614 0a.0739.0739 0 01.0785.0095c.1202.099.246.1981.3728.2924a.077.077 0 01-.0066.1276 12.2986 12.2986 0 01-1.873.8914.0766.0766 0 00-.0407.1067c.3604.698.7719 1.3628 1.225 1.9932a.076.076 0 00.0842.0286c1.961-.6067 3.9495-1.5219 6.0023-3.0294a.077.077 0 00.0313-.0552c.5004-5.177-.8382-9.6739-3.5485-13.6604a.061.061 0 00-.0312-.0286zM8.02 15.3312c-1.1825 0-2.1569-1.0857-2.1569-2.419 0-1.3332.9555-2.4189 2.157-2.4189 1.2108 0 2.1757 1.0952 2.1568 2.419 0 1.3332-.9555 2.4189-2.1569 2.4189zm7.9748 0c-1.1825 0-2.1569-1.0857-2.1569-2.419 0-1.3332.9554-2.4189 2.1569-2.4189 1.2108 0 2.1757 1.0952 2.1568 2.419 0 1.3332-.946 2.4189-2.1568 2.4189Z"/></svg>
        Discordサーバーに参加する
      </a>
    </div>

    <p class="gp-hint">💳 カード、Apple Pay、Google Payがご利用いただけます</p>
    <p class="note">決済はStripeにより安全に処理されます</p>
  </div>

  <script>
    // === パララックススクロールの処理 ===
    window.addEventListener('scroll', () => {
      const scrolled = window.scrollY;
      const parallaxBg = document.getElementById('parallaxBg');
      if (parallaxBg) {
        // スクロール量の0.5倍だけ背景を下に動かす
        parallaxBg.style.transform = \`translate3d(0, \${scrolled * 0.5}px, 0)\`;
      }
    });

    // === 決済処理 ===
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

    // === 決済完了後の処理 ===
    const params = new URLSearchParams(window.location.search);
    const sessionId = params.get('session_id');
    if (sessionId && window.location.pathname === '/success') {
      document.body.innerHTML = '<div class="card" style="max-width:480px;margin:40px auto;background:#111;color:white;padding:30px;border-radius:20px;"><h2 style="text-align:center;">✅ 決済完了</h2><p style="text-align:center;margin:20px 0;color:#ccc;">トークンを発行しています...</p></div>';
      fetch('/api/fulfill', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sessionId }),
      }).then(r => r.json()).then(data => {
        if (data.success) {
          document.body.innerHTML = \`<div class="card" style="max-width:480px;margin:40px auto;background:#111;color:white;padding:30px;border-radius:20px;"><h2 style="text-align:center;">🎉 購入完了！</h2><p style="text-align:center;margin:16px 0;color:#ccc;">あなたのトークン：</p><div style="background:#222;padding:20px;border-radius:12px;text-align:center;border:1px solid #444;"><code style="font-size:20px;font-weight:bold;color:#5865F2;word-break:break-all;">\${data.token}</code></div><p style="text-align:center;margin-top:20px;font-size:14px;color:#888;">このトークンをゲーム内で入力してください</p></div>\`;
        } else {
          document.body.innerHTML = '<div class="card" style="max-width:480px;margin:40px auto;background:#111;color:white;padding:30px;border-radius:20px;"><h2 style="text-align:center;">⚠️ エラー</h2><p style="text-align:center;color:#ff5555;">' + (data.error || 'トークン発行に失敗しました') + '</p></div>';
        }
      });
    }
  </script>
</body>
</html>`;
}
