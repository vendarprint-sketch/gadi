import fetch from 'node-fetch';
import { HttpsProxyAgent } from 'https-proxy-agent';
import { SocksProxyAgent } from 'socks-proxy-agent';

// IPRoyal Proxy Credentials[cite: 1, 2]
const proxyAuth = 'QAF011bD6k0KrTcs:sndOTTxLhyDnvHx9_country-in';
const proxyHost = 'geo.iproyal.com:12321';

// SOCKS5 और HTTP दोनों प्रॉक्सी एजेंट्स तैयार करना[cite: 1, 2]
const PROXIES = [
  { name: 'IPRoyal_SOCKS5', agent: new SocksProxyAgent(`socks5://${proxyAuth}@${proxyHost}`) },
  { name: 'IPRoyal_HTTP', agent: new HttpsProxyAgent(`http://${proxyAuth}@${proxyHost}`) }
];

const POLICYBOSS_URL = 'https://horizon.policyboss.com:5443/quote/vehicle_info_loggedin';
const PAYLOAD_TEMPLATE = {
  secret_key: "SECRET-HZ07QRWY-JIBT-XRMQ-ZP95-J0RWP3DYRACW",
  client_key: "CLIENT-CNTP6NYE-CU9N-DUZW-CSPI-SH1IS4DOVHB9",
  ss_id: 0,
  source: "PB-BETA",
  session_id: ""
};

const USER_AGENTS = [
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
  'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36',
  'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile Safari/604.1'
];

function cleanResponse(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const junk = ['Ip_Address', 'Calling_Source', 'Product_Id_Request', 'Ss_Id', 'Channel', 'Is_LM', 'FastLaneId', 'Match_Mode', 'FastlaneResponse', 'FastlaneResponse_Obj'];
  const out = {};
  
  for (const [k, v] of Object.entries(raw)) {
    if (!junk.includes(k) && isNaN(parseInt(k))) {
      out[k] = v;
    }
  }
  
  const noVahan = raw['0'] === 'N';
  out.found = !noVahan && !!out.Make_Name;
  out.ParsedData = raw.FastlaneResponse_Obj?.vehicle || null;
  
  return out;
}

export default async function handler(req, res) {
  // CORS Headers
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  
  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  const regNumber = req.query.number || req.body?.number || req.body?.RegistrationNumber;
  const productId = parseInt(req.query.product_id || req.body?.product_id || 1);

  if (!regNumber) {
    return res.status(400).json({ status: 'Error', error: 'Missing number parameter', developer: '@techvishalboss' });
  }

  const cleanRegNumber = regNumber.replace(/[\s-]+/g, '').toUpperCase();
  const body = JSON.stringify({
    ...PAYLOAD_TEMPLATE,
    RegistrationNumber: cleanRegNumber,
    product_id: productId
  });

  let finalResult = null;
  let strategyUsed = '';
  let proxyTypeUsed = '';
  let lastError = '';

  // Multi-tier Fallback: UAs के साथ-साथ Proxies को भी लूप में ट्राई करना
  for (let i = 0; i < USER_AGENTS.length; i++) {
    const ua = USER_AGENTS[i];
    
    for (let p = 0; p < PROXIES.length; p++) {
      const currentProxy = PROXIES[p];
      
      try {
        const response = await fetch(POLICYBOSS_URL, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json;charset=utf-8',
            'Accept': 'application/json',
            'Origin': 'https://www.policyboss.com',
            'Referer': 'https://www.policyboss.com/car-insurance',
            'User-Agent': ua,
            'Connection': 'keep-alive',
            'Accept-Language': 'en-US,en;q=0.9'
          },
          body: body,
          agent: currentProxy.agent
        });

        const text = await response.text();

        if (text.includes('ACCESS_DENIED_HOURLY_USAGE_VALIDATION') || text.includes('ACCESS_DENIED_IP_USAGE_VALIDATION')) {
          lastError = 'Rate limited or blocked by PolicyBoss';
          continue; 
        }

        let data;
        try {
          data = JSON.parse(text);
        } catch (e) {
          // UPDATE: यहाँ हमें असली HTML या टेक्स्ट एरर दिखेगा कि PolicyBoss रिजेक्ट क्यों कर रहा है
          lastError = `Invalid JSON. Raw Response: ${text.substring(0, 300)}`; 
          continue; 
        }

        const cleaned = cleanResponse(data);
        if (cleaned && cleaned.found) {
          finalResult = cleaned;
          strategyUsed = `UA-${i + 1}`;
          proxyTypeUsed = currentProxy.name;
          break; 
        } else if (cleaned) {
          finalResult = cleaned;
          strategyUsed = `UA-${i + 1}`;
          proxyTypeUsed = currentProxy.name;
          lastError = 'Vehicle not found in PolicyBoss';
          break; 
        }
      } catch (error) {
        lastError = `${currentProxy.name} Error: ${error.message}`;
      }
    }
    
    if (finalResult) break; 
  }

  if (finalResult && finalResult.found) {
    return res.status(200).json({
      status: 'Success',
      registration_number: cleanRegNumber,
      source: 'PolicyBoss',
      strategy: strategyUsed,
      proxy_used: proxyTypeUsed,
      developer: '@techvishalboss',
      data: finalResult
    });
  } else {
    return res.status(400).json({
      status: 'Error',
      registration_number: cleanRegNumber,
      error: lastError || 'All proxies and strategies failed',
      developer: '@techvishalboss',
      partial_data: finalResult
    });
  }
}
