/** Canned system replies in the customer's language. Falls back to English. */
const strings: Record<string, Record<string, string>> = {
  handoff: {
    en: "I'm connecting you with a teammate who can help with this. They'll reply right here shortly.",
    hi: 'मैं आपको हमारी टीम के एक सदस्य से जोड़ रहा हूँ। वे जल्द ही यहीं जवाब देंगे।',
    kn: 'ನಿಮಗೆ ಸಹಾಯ ಮಾಡಲು ನಮ್ಮ ತಂಡದ ಸದಸ್ಯರನ್ನು ಸಂಪರ್ಕಿಸುತ್ತಿದ್ದೇನೆ. ಅವರು ಶೀಘ್ರದಲ್ಲೇ ಇಲ್ಲಿಯೇ ಉತ್ತರಿಸುತ್ತಾರೆ.',
    ta: 'உங்களுக்கு உதவ எங்கள் குழு உறுப்பினரை இணைக்கிறேன். அவர்கள் விரைவில் இங்கே பதிலளிப்பார்கள்.',
    te: 'మీకు సహాయం చేయడానికి మా బృంద సభ్యుడిని కలుపుతున్నాను. వారు త్వరలో ఇక్కడే సమాధానం ఇస్తారు.',
  },
  greeting: {
    en: 'Hello! How can I help you today?',
    hi: 'नमस्ते! मैं आपकी क्या मदद कर सकता हूँ?',
    kn: 'ನಮಸ್ಕಾರ! ನಾನು ನಿಮಗೆ ಹೇಗೆ ಸಹಾಯ ಮಾಡಲಿ?',
    ta: 'வணக்கம்! நான் உங்களுக்கு எப்படி உதவ முடியும்?',
    te: 'నమస్కారం! నేను మీకు ఎలా సహాయం చేయగలను?',
  },
  thanks: {
    en: "You're welcome! Is there anything else I can help with?",
    hi: 'आपका स्वागत है! क्या मैं और कुछ मदद कर सकता हूँ?',
    kn: 'ಸ್ವಾಗತ! ಇನ್ನೇನಾದರೂ ಸಹಾಯ ಬೇಕೇ?',
    ta: 'மகிழ்ச்சி! வேறு ஏதாவது உதவி வேண்டுமா?',
    te: 'సంతోషం! ఇంకేమైనా సహాయం కావాలా?',
  },
  askParam: {
    en: 'Sure — could you share your {param}?',
    hi: 'ज़रूर — कृपया अपना {param} बताइए।',
    kn: 'ಖಂಡಿತ — ದಯವಿಟ್ಟು ನಿಮ್ಮ {param} ಹಂಚಿಕೊಳ್ಳಿ.',
    ta: 'நிச்சயமாக — உங்கள் {param} பகிர முடியுமா?',
    te: 'తప్పకుండా — దయచేసి మీ {param} తెలియజేయండి.',
  },
  pendingApproval: {
    en: "Thanks! For your security, a teammate will verify and complete this request. You'll get an update here.",
    hi: 'धन्यवाद! आपकी सुरक्षा के लिए, हमारी टीम इस अनुरोध की पुष्टि करके इसे पूरा करेगी। आपको यहीं अपडेट मिलेगा।',
    kn: 'ಧನ್ಯವಾದಗಳು! ನಿಮ್ಮ ಸುರಕ್ಷತೆಗಾಗಿ, ನಮ್ಮ ತಂಡ ಈ ವಿನಂತಿಯನ್ನು ಪರಿಶೀಲಿಸಿ ಪೂರ್ಣಗೊಳಿಸುತ್ತದೆ.',
  },
  limit: {
    en: "Thanks for your message! A teammate will get back to you here soon.",
    hi: 'आपके संदेश के लिए धन्यवाद! हमारी टीम जल्द ही यहीं जवाब देगी।',
    kn: 'ನಿಮ್ಮ ಸಂದೇಶಕ್ಕೆ ಧನ್ಯವಾದಗಳು! ನಮ್ಮ ತಂಡ ಶೀಘ್ರದಲ್ಲೇ ಇಲ್ಲಿ ಉತ್ತರಿಸುತ್ತದೆ.',
  },
};

export function t(key: keyof typeof strings, lang: string, vars: Record<string, string> = {}): string {
  const table = strings[key]!;
  let s = table[lang] ?? table.en!;
  for (const [k, v] of Object.entries(vars)) s = s.replace(`{${k}}`, v);
  return s;
}

const handoffRe =
  /\b(human|agent|person|representative|real person|someone real|talk to (a )?(human|person|someone)|customer care|manager|supervisor|insaan)\b|इंसान|एजेंट|किसी व्यक्ति|ಮನುಷ್ಯ|ವ್ಯಕ್ತಿಯೊಂದಿಗೆ|ಏಜೆಂಟ್|மனிதர்|முகவர்/i;

export function wantsHuman(text: string): boolean {
  return handoffRe.test(text);
}

const greetingRe = /^\s*(hi+|hello+|hey+|namaste|namaskar|vanakkam|good (morning|afternoon|evening)|नमस्ते|नमस्कार|ನಮಸ್ಕಾರ|ಹಾಯ್|வணக்கம்|నమస్కారం)[\s!.,🙏👋]*$/i;
const thanksRe = /^\s*(thanks?( you)?( so much)?|thx|ty|ok(ay)? thanks?|dhanyavad|shukriya|धन्यवाद|शुक्रिया|ಧನ್ಯವಾದ(ಗಳು)?|நன்றி|ధన్యవాదాలు)[\s!.,🙏👍]*$/i;

export function smalltalk(text: string): 'greeting' | 'thanks' | null {
  if (greetingRe.test(text)) return 'greeting';
  if (thanksRe.test(text)) return 'thanks';
  return null;
}
