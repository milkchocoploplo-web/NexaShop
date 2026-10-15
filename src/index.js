// Cloudflare Worker - Nexa トークン販売サイト（多言語・多通貨決済対応版）

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
    if (!stripeResponse.ok) {
      console.error('Stripe full error:', JSON.stringify(session));
      throw new Error(JSON.stringify(session));
    }

    return new Response(JSON.stringify({ url: session.url }), { headers: { 'Content-Type': 'application/json', ...corsHeaders } });
  } catch (err) {
    console.error('Checkout creation failed:', err);
    return new Response(JSON.stringify({ error: 'Internal error' }), { status: 500, headers: { 'Content-Type': 'application/json', ...corsHeaders } });
  }
}

// ============================================================
// 決済完了後のトークン発行（通貨を問わずプランを判定）
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

    // 通貨を問わず、同じプランなら同じ回数・期限を適用
    const plan500Ids = [env.STRIPE_PRICE_ID_500, env.STRIPE_PRICE_ID_500_USD, env.STRIPE_PRICE_ID_500_KRW];
    const plan1000Ids = [env.STRIPE_PRICE_ID_1000, env.STRIPE_PRICE_ID_1000_USD, env.STRIPE_PRICE_ID_1000_KRW];
    const plan1500Ids = [env.STRIPE_PRICE_ID_1500, env.STRIPE_PRICE_ID_1500_USD, env.STRIPE_PRICE_ID_1500_KRW];

    if (plan500Ids.includes(priceId)) {
      uses = 50;
      expires = getFutureDate(30);
    } else if (plan1000Ids.includes(priceId)) {
      uses = 150;
      expires = getFutureDate(30);
    } else if (plan1500Ids.includes(priceId)) {
      uses = 1000000;
      expires = '2090-12-31';
    } else {
      return new Response(JSON.stringify({ error: 'Unknown price ID' }), { status: 400, headers: { 'Content-Type': 'application/json', ...corsHeaders } });
    }

    const token = await issueTokenOnRender(env, session, uses, expires);

    return new Response(JSON.stringify({ success: true, token, message: 'Token issued.' }), {
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
// 販売ページHTML（多言語・多通貨決済対応版）
// ============================================================
function getSalesPageHTML(env) {
  const prices = {
    ja: {
      500: env.STRIPE_PRICE_ID_500 || 'PRICE_500_NOT_SET',
      1000: env.STRIPE_PRICE_ID_1000 || 'PRICE_1000_NOT_SET',
      1500: env.STRIPE_PRICE_ID_1500 || 'PRICE_1500_NOT_SET',
    },
    en: {
      500: env.STRIPE_PRICE_ID_500_USD || 'PRICE_500_USD_NOT_SET',
      1000: env.STRIPE_PRICE_ID_1000_USD || 'PRICE_1000_USD_NOT_SET',
      1500: env.STRIPE_PRICE_ID_1500_USD || 'PRICE_1500_USD_NOT_SET',
    },
    ko: {
      500: env.STRIPE_PRICE_ID_500_KRW || 'PRICE_500_KRW_NOT_SET',
      1000: env.STRIPE_PRICE_ID_1000_KRW || 'PRICE_1000_KRW_NOT_SET',
      1500: env.STRIPE_PRICE_ID_1500_KRW || 'PRICE_1500_KRW_NOT_SET',
    },
  };

  const pricesJSON = JSON.stringify(prices);

  return `<!DOCTYPE html>
<html lang="ja">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Nexa トークン販売</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    
    body { 
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; 
      background: #080808; 
      min-height: 100vh; 
      color: #ffffff; 
      display: flex;
      justify-content: center;
      padding: 40px 20px;
    }

    .container { 
      max-width: 1000px; 
      width: 100%; 
      margin: 0 auto; 
    }
    
    h1 { 
      text-align: center; 
      color: #ffffff; 
      margin-bottom: 40px; 
      font-size: 32px; 
      text-shadow: 0 0 15px rgba(255,255,255,0.15); 
    }
    
    .plans { 
      display: grid; 
      grid-template-columns: repeat(auto-fit, minmax(280px, 1fr)); 
      gap: 24px; 
    }
    
    .card { 
      background: #121212; 
      border: 1px solid #2a2a2a; 
      border-radius: 20px; 
      padding: 35px 25px; 
      text-align: center; 
      transition: transform 0.3s, border-color 0.3s; 
      position: relative; 
    }
    .card:hover { 
      transform: translateY(-5px); 
      border-color: #5865F2; 
    }
    .card.popular { 
      border: 2px solid #5865F2; 
      box-shadow: 0 0 30px rgba(88, 101, 242, 0.15);
    }
    
    .badge { 
      position: absolute; 
      top: -13px; 
      left: 50%; 
      transform: translateX(-50%); 
      background: #5865F2; 
      color: white; 
      padding: 5px 16px; 
      border-radius: 20px; 
      font-size: 12px; 
      font-weight: bold; 
    }
    
    .plan-name { 
      font-size: 18px; 
      color: #aaaaaa; 
      margin-bottom: 15px; 
    }
    
    .price { 
      font-size: 44px; 
      font-weight: bold; 
      color: #ffffff; 
      margin-bottom: 25px; 
    }
    
    .features { 
      list-style: none; 
      margin: 0 0 25px 0; 
      padding: 0; 
      text-align: left; 
      border-top: 1px solid #222;
    }
    .features li { 
      padding: 12px 0; 
      font-size: 14px; 
      color: #cccccc; 
      border-bottom: 1px solid #222; 
    }
    .features li:last-child { 
      border-bottom: none; 
    }
    .check { 
      color: #4CAF50; 
      margin-right: 8px; 
      font-weight: bold;
    }
    
    .pay-btn { 
      width: 100%; 
      padding: 16px; 
      background: #ffffff; 
      color: #000000; 
      border: none; 
      border-radius: 12px; 
      font-size: 16px; 
      font-weight: bold; 
      cursor: pointer; 
      transition: all 0.2s; 
    }
    .pay-btn:hover { 
      opacity: 0.85; 
      transform: scale(1.02); 
    }
    .pay-btn:disabled { 
      opacity: 0.5; 
      cursor: not-allowed; 
    }
    
    .discord-section { 
      text-align: center; 
      margin-top: 40px; 
    }
    .discord-btn { 
      display: inline-flex; 
      align-items: center; 
      background: #5865F2; 
      color: white; 
      padding: 14px 28px; 
      border-radius: 12px; 
      text-decoration: none; 
      font-weight: bold; 
      font-size: 16px; 
      transition: 0.2s; 
      box-shadow: 0 4px 15px rgba(88, 101, 242, 0.3); 
    }
    .discord-btn:hover { 
      background: #4752C4; 
      transform: translateY(-2px); 
      box-shadow: 0 6px 20px rgba(88, 101, 242, 0.5); 
    }
    .discord-btn svg { 
      margin-right: 10px; 
      width: 22px; 
      height: 22px; 
      fill: currentColor; 
    }
    
    .gp-hint { 
      text-align: center; 
      font-size: 13px; 
      color: #888888; 
      margin-top: 30px; 
    }
    .note { 
      text-align: center; 
      font-size: 12px; 
      color: #444444; 
      margin-top: 10px; 
    }

    .lang-selector {
      position: fixed;
      top: 20px;
      right: 20px;
      z-index: 1000;
    }
    .lang-selector select {
      background: #1a1a1a;
      color: #fff;
      border: 1px solid #444;
      border-radius: 8px;
      padding: 8px 12px;
      font-size: 14px;
      cursor: pointer;
      outline: none;
      transition: border-color 0.2s;
    }
    .lang-selector select:hover {
      border-color: #5865F2;
    }
    
    @media (max-width: 600px) { 
      .plans { grid-template-columns: 1fr; } 
      h1 { font-size: 26px; margin-bottom: 30px; }
      .price { font-size: 38px; }
    }
  </style>
</head>
<body>
  <div class="lang-selector">
    <select id="langSelect">
      <option value="ja">日本語</option>
      <option value="en">English</option>
      <option value="ko">한국어</option>
    </select>
  </div>

  <div class="container">
    <h1 data-i18n="title">Nexa トークン販売</h1>
    
    <div class="plans">
      <div class="card">
        <div class="plan-name" data-i18n="plan1">お試しプラン</div>
        <div class="price" data-i18n="price1">¥500</div>
        <ul class="features">
          <li><span class="check">✓</span> <span data-i18n-html="feature1_1"><b>50回分</b>の使用権</span></li>
          <li><span class="check">✓</span> <span data-i18n="feature1_2">発行から30日間有効</span></li>
          <li><span class="check">✓</span> <span data-i18n="feature1_3">1端末のみで使用可能</span></li>
        </ul>
        <button class="pay-btn" onclick="startPayment(500)" data-i18n="buy">購入する</button>
      </div>

      <div class="card popular">
        <div class="badge" data-i18n="popular">人気</div>
        <div class="plan-name" data-i18n="plan2">スタンダードプラン</div>
        <div class="price" data-i18n="price2">¥1,000</div>
        <ul class="features">
          <li><span class="check">✓</span> <span data-i18n-html="feature2_1"><b>150回分</b>の使用権</span></li>
          <li><span class="check">✓</span> <span data-i18n="feature2_2">発行から30日間有効</span></li>
          <li><span class="check">✓</span> <span data-i18n="feature2_3">1端末のみで使用可能</span></li>
        </ul>
        <button class="pay-btn" onclick="startPayment(1000)" data-i18n="buy">購入する</button>
      </div>

      <div class="card">
        <div class="plan-name" data-i18n="plan3">プレミアムプラン</div>
        <div class="price" data-i18n="price3">¥1,500</div>
        <ul class="features">
          <li><span class="check">✓</span> <span data-i18n-html="feature3_1"><b>無制限</b></span></li>
          <li><span class="check">✓</span> <span data-i18n-html="feature3_2"><b>無期限</b> ✅</span></li>
          <li><span class="check">✓</span> <span data-i18n="feature3_3">1端末のみで使用可能</span></li>
        </ul>
        <button class="pay-btn" onclick="startPayment(1500)" data-i18n="buy">購入する</button>
      </div>
    </div>
    
    <div class="discord-section">
      <a href="https://discord.gg/jc3mx8N3wT" target="_blank" class="discord-btn">
        <svg viewBox="0 0 24 24"><path d="M20.317 4.3698a19.7913 19.7913 0 00-4.8851-1.5152.0741.0741 0 00-.0785.0371c-.211.3753-.4447.8648-.6083 1.2495-1.8447-.2762-3.68-.2762-5.4868 0-.1636-.3933-.4058-.8742-.6177-1.2495a.077.077 0 00-.0785-.037 19.7363 19.7363 0 00-4.8852 1.515.0699.0699 0 00-.0321.0277C.5334 9.0458-.319 13.5799.0992 18.0578a.0824.0824 0 00.0312.0561c2.0528 1.5076 4.0413 2.4228 5.9929 3.0294a.0777.0777 0 00.0842-.0276c.4616-.6304.8731-1.2952 1.226-1.9942a.076.076 0 00-.0416-.1057c-.6528-.2476-1.2743-.5495-1.8722-.8923a.077.077 0 01-.0076-.1277c.1258-.0943.2517-.1923.3718-.2914a.0743.0743 0 01.0776-.0105c3.9278 1.7933 8.18 1.7933 12.0614 0a.0739.0739 0 01.0785.0095c.1202.099.246.1981.3728.2924a.077.077 0 01-.0066.1276 12.2986 12.2986 0 01-1.873.8914.0766.0766 0 00-.0407.1067c.3604.698.7719 1.3628 1.225 1.9932a.076.076 0 00.0842.0286c1.961-.6067 3.9495-1.5219 6.0023-3.0294a.077.077 0 00.0313-.0552c.5004-5.177-.8382-9.6739-3.5485-13.6604a.061.061 0 00-.0312-.0286zM8.02 15.3312c-1.1825 0-2.1569-1.0857-2.1569-2.419 0-1.3332.9555-2.4189 2.157-2.4189 1.2108 0 2.1757 1.0952 2.1568 2.419 0 1.3332-.9555 2.4189-2.1569 2.4189zm7.9748 0c-1.1825 0-2.1569-1.0857-2.1569-2.419 0-1.3332.9554-2.4189 2.1569-2.4189 1.2108 0 2.1757 1.0952 2.1568 2.419 0 1.3332-.946 2.4189-2.1568 2.4189Z"/></svg>
        <span data-i18n="discord">Discordサーバーに参加する</span>
      </a>
    </div>

    <p class="gp-hint" data-i18n="hint">💳 カード、Apple Pay、Google Payがご利用いただけます</p>
    <p class="note" data-i18n="note">決済はStripeにより安全に処理されます</p>
  </div>

  <script>
    // === 価格ID（言語ごとに異なるStripe Price ID） ===
    const PRICE_IDS = ${pricesJSON};

    // === 多言語翻訳データ ===
    const translations = {
      ja: {
        title: "Nexa トークン販売",
        plan1: "お試しプラン",
        plan2: "スタンダードプラン",
        plan3: "プレミアムプラン",
        price1: "¥500",
        price2: "¥1,000",
        price3: "¥1,500",
        feature1_1: "<b>50回分</b>の使用権",
        feature1_2: "発行から30日間有効",
        feature1_3: "1端末のみで使用可能",
        feature2_1: "<b>150回分</b>の使用権",
        feature2_2: "発行から30日間有効",
        feature2_3: "1端末のみで使用可能",
        feature3_1: "<b>無制限</b>",
        feature3_2: "<b>無期限</b> ✅",
        feature3_3: "1端末のみで使用可能",
        buy: "購入する",
        popular: "人気",
        discord: "Discordサーバーに参加する",
        hint: "💳 カード、Apple Pay、Google Payがご利用いただけます",
        note: "決済はStripeにより安全に処理されます",
        processing: "処理中...",
        checkoutComplete: "✅ 決済完了",
        issuing: "トークンを発行しています...",
        purchaseComplete: "🎉 購入完了！",
        yourToken: "あなたのトークン：",
        tokenInstructions: "このトークンをゲーム内で入力してください",
        errorTitle: "⚠️ エラー",
        errorMessage: "トークン発行に失敗しました",
        stripeNotSet: "StripeのPrice IDが設定されていません。管理画面を確認してください。",
        checkoutFailed: "決済を開始できませんでした",
        networkError: "通信エラー"
      },
      en: {
        title: "Nexa Token Shop",
        plan1: "Trial Plan",
        plan2: "Standard Plan",
        plan3: "Premium Plan",
        price1: "$5",
        price2: "$10",
        price3: "$15",
        feature1_1: "<b>50 uses</b>",
        feature1_2: "Valid for 30 days",
        feature1_3: "Usable on 1 device",
        feature2_1: "<b>150 uses</b>",
        feature2_2: "Valid for 30 days",
        feature2_3: "Usable on 1 device",
        feature3_1: "<b>Unlimited</b>",
        feature3_2: "<b>No expiration</b> ✅",
        feature3_3: "Usable on 1 device",
        buy: "Purchase",
        popular: "Popular",
        discord: "Join Discord Server",
        hint: "💳 Card, Apple Pay, Google Pay accepted",
        note: "Payments securely processed by Stripe",
        processing: "Processing...",
        checkoutComplete: "✅ Payment Complete",
        issuing: "Issuing your token...",
        purchaseComplete: "🎉 Purchase Complete!",
        yourToken: "Your token:",
        tokenInstructions: "Enter this token in the game",
        errorTitle: "⚠️ Error",
        errorMessage: "Failed to issue token",
        stripeNotSet: "Stripe Price ID is not configured. Please check the admin panel.",
        checkoutFailed: "Could not start checkout",
        networkError: "Network error"
      },
      ko: {
        title: "Nexa 토큰 판매",
        plan1: "체험 플랜",
        plan2: "스탠다드 플랜",
        plan3: "프리미엄 플랜",
        price1: "₩6,690",
        price2: "₩13,380",
        price3: "₩20,070",
        feature1_1: "<b>50회</b> 사용권",
        feature1_2: "발급 후 30일 유효",
        feature1_3: "1대 기기에서만 사용 가능",
        feature2_1: "<b>150회</b> 사용권",
        feature2_2: "발급 후 30일 유효",
        feature2_3: "1대 기기에서만 사용 가능",
        feature3_1: "<b>무제한</b>",
        feature3_2: "<b>무기한</b> ✅",
        feature3_3: "1대 기기에서만 사용 가능",
        buy: "구매하기",
        popular: "인기",
        discord: "Discord 서버 참가",
        hint: "💳 카드, Apple Pay, Google Pay 사용 가능",
        note: "결제는 Stripe를 통해 안전하게 처리됩니다",
        processing: "처리 중...",
        checkoutComplete: "✅ 결제 완료",
        issuing: "토큰을 발급하고 있습니다...",
        purchaseComplete: "🎉 구매 완료!",
        yourToken: "당신의 토큰:",
        tokenInstructions: "이 토큰을 게임 내에서 입력해 주세요",
        errorTitle: "⚠️ 오류",
        errorMessage: "토큰 발급에 실패했습니다",
        stripeNotSet: "Stripe Price ID가 설정되지 않았습니다. 관리 화면을 확인해 주세요.",
        checkoutFailed: "결제를 시작할 수 없습니다",
        networkError: "통신 오류"
      }
    };

    let currentLang = localStorage.getItem('lang') || 'ja';

    function t(key) {
      return translations[currentLang][key] || key;
    }

    function setLanguage(lang) {
      if (!translations[lang]) return;
      currentLang = lang;
      const tr = translations[lang];
      
      document.querySelectorAll('[data-i18n]').forEach(el => {
        const key = el.getAttribute('data-i18n');
        if (tr[key]) el.textContent = tr[key];
      });
      document.querySelectorAll('[data-i18n-html]').forEach(el => {
        const key = el.getAttribute('data-i18n-html');
        if (tr[key]) el.innerHTML = tr[key];
      });
      
      localStorage.setItem('lang', lang);
      document.documentElement.lang = lang;
    }

    document.getElementById('langSelect').value = currentLang;
    setLanguage(currentLang);

    document.getElementById('langSelect').addEventListener('change', (e) => {
      setLanguage(e.target.value);
    });

    // === 決済処理（言語に応じたPrice IDを使用） ===
    async function startPayment(plan) {
      const priceId = PRICE_IDS[currentLang] && PRICE_IDS[currentLang][plan];
      if (!priceId || priceId.includes('NOT_SET')) {
        alert(t('stripeNotSet'));
        return;
      }
      const btn = event.target;
      btn.disabled = true;
      btn.textContent = t('processing');
      try {
        const res = await fetch('/api/create-checkout', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ priceId }),
        });
        const data = await res.json();
        if (data.url) window.location.href = data.url;
        else { alert(t('errorTitle') + ': ' + (data.error || t('checkoutFailed'))); btn.disabled = false; btn.textContent = t('buy'); }
      } catch (err) { alert(t('networkError')); btn.disabled = false; btn.textContent = t('buy'); }
    }

    // === 決済完了後の処理（多言語対応） ===
    const params = new URLSearchParams(window.location.search);
    const sessionId = params.get('session_id');
    if (sessionId && window.location.pathname === '/success') {
      document.body.innerHTML = '<div class="card" style="max-width:480px;margin:40px auto;background:#111;color:white;padding:30px;border-radius:20px;text-align:center;"><h2>' + t('checkoutComplete') + '</h2><p style="margin:20px 0;color:#ccc;">' + t('issuing') + '</p></div>';
      fetch('/api/fulfill', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sessionId }),
      }).then(r => r.json()).then(data => {
        if (data.success) {
          document.body.innerHTML = \`<div class="card" style="max-width:480px;margin:40px auto;background:#111;color:white;padding:30px;border-radius:20px;text-align:center;"><h2>\${t('purchaseComplete')}</h2><p style="margin:16px 0;color:#ccc;">\${t('yourToken')}</p><div style="background:#222;padding:20px;border-radius:12px;border:1px solid #444;"><code style="font-size:20px;font-weight:bold;color:#5865F2;word-break:break-all;">\${data.token}</code></div><p style="margin-top:20px;font-size:14px;color:#888;">\${t('tokenInstructions')}</p></div>\`;
        } else {
          document.body.innerHTML = '<div class="card" style="max-width:480px;margin:40px auto;background:#111;color:white;padding:30px;border-radius:20px;text-align:center;"><h2>' + t('errorTitle') + '</h2><p style="color:#ff5555;">' + (data.error || t('errorMessage')) + '</p></div>';
        }
      });
    }
  </script>
</body>
</html>`;
}
