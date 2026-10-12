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
  emergency: {
    en: '⚠️ This sounds like an emergency. Please call {number} (ambulance) right now or go to the nearest emergency room. I have alerted our team, and someone will call you back immediately.',
    ta: '⚠️ இது அவசர நிலை போல் தெரிகிறது. உடனே {number} (ஆம்புலன்ஸ்) அழைக்கவும் அல்லது அருகிலுள்ள அவசர சிகிச்சைப் பிரிவுக்குச் செல்லவும். எங்கள் குழுவுக்குத் தெரிவித்துவிட்டேன், உடனே உங்களைத் தொடர்புகொள்வார்கள்.',
    hi: '⚠️ यह आपातकालीन स्थिति लगती है। कृपया तुरंत {number} (एम्बुलेंस) पर कॉल करें या नज़दीकी इमरजेंसी में जाएँ। मैंने हमारी टीम को सूचित कर दिया है, वे तुरंत आपसे संपर्क करेंगे।',
    kn: '⚠️ ಇದು ತುರ್ತು ಪರಿಸ್ಥಿತಿಯಂತೆ ಕಾಣುತ್ತದೆ. ದಯವಿಟ್ಟು ತಕ್ಷಣ {number} (ಆಂಬ್ಯುಲೆನ್ಸ್) ಗೆ ಕರೆ ಮಾಡಿ ಅಥವಾ ಹತ್ತಿರದ ತುರ್ತು ಚಿಕಿತ್ಸಾ ವಿಭಾಗಕ್ಕೆ ಹೋಗಿ. ನಮ್ಮ ತಂಡಕ್ಕೆ ತಿಳಿಸಿದ್ದೇನೆ.',
    te: '⚠️ ఇది అత్యవసర పరిస్థితిలా ఉంది. దయచేసి వెంటనే {number} (అంబులెన్స్) కి కాల్ చేయండి లేదా దగ్గరలోని ఎమర్జెన్సీకి వెళ్ళండి. మా బృందానికి తెలియజేశాను.',
  },
  noMedicalAdvice: {
    en: "I can't give medical advice, but I've passed your question to our clinical team. A doctor or nurse will reply here. If it's urgent, please call {number}.",
    ta: 'என்னால் மருத்துவ ஆலோசனை வழங்க முடியாது. உங்கள் கேள்வியை எங்கள் மருத்துவக் குழுவுக்கு அனுப்பியுள்ளேன். மருத்துவர் அல்லது செவிலியர் இங்கே பதிலளிப்பார். அவசரம் என்றால் {number} அழைக்கவும்.',
    hi: 'मैं चिकित्सा सलाह नहीं दे सकता, लेकिन आपका सवाल हमारी क्लिनिकल टीम को भेज दिया है। डॉक्टर या नर्स यहीं जवाब देंगे। ज़रूरी हो तो {number} पर कॉल करें।',
    kn: 'ನಾನು ವೈದ್ಯಕೀಯ ಸಲಹೆ ನೀಡಲು ಸಾಧ್ಯವಿಲ್ಲ, ನಿಮ್ಮ ಪ್ರಶ್ನೆಯನ್ನು ನಮ್ಮ ವೈದ್ಯಕೀಯ ತಂಡಕ್ಕೆ ಕಳುಹಿಸಿದ್ದೇನೆ. ತುರ್ತು ಇದ್ದರೆ {number} ಗೆ ಕರೆ ಮಾಡಿ.',
    te: 'నేను వైద్య సలహా ఇవ్వలేను, మీ ప్రశ్నను మా వైద్య బృందానికి పంపాను. అత్యవసరమైతే {number} కి కాల్ చేయండి.',
  },
  chooseStaff: {
    en: 'Sure, let us book your appointment. Who would you like to see? Reply with a number:\n{list}',
    ta: 'சரி, உங்கள் முன்பதிவைச் செய்வோம். யாரைச் சந்திக்க விரும்புகிறீர்கள்? எண்ணை அனுப்பவும்:\n{list}',
    hi: 'ज़रूर, आपकी अपॉइंटमेंट बुक करते हैं। आप किससे मिलना चाहेंगे? नंबर भेजें:\n{list}',
    kn: 'ಸರಿ, ನಿಮ್ಮ ಅಪಾಯಿಂಟ್ಮೆಂಟ್ ಬುಕ್ ಮಾಡೋಣ. ಯಾರನ್ನು ಭೇಟಿ ಮಾಡಲು ಬಯಸುತ್ತೀರಿ? ಸಂಖ್ಯೆಯನ್ನು ಕಳುಹಿಸಿ:\n{list}',
    te: 'సరే, మీ అపాయింట్‌మెంట్ బుక్ చేద్దాం. ఎవరిని కలవాలనుకుంటున్నారు? సంఖ్యను పంపండి:\n{list}',
  },
  chooseSlot: {
    en: 'Available times with {staff}. Reply with a number:\n{list}',
    ta: '{staff} அவர்களுடன் கிடைக்கும் நேரங்கள். எண்ணை அனுப்பவும்:\n{list}',
    hi: '{staff} के साथ उपलब्ध समय। नंबर भेजें:\n{list}',
    kn: '{staff} ಅವರೊಂದಿಗೆ ಲಭ್ಯವಿರುವ ಸಮಯಗಳು. ಸಂಖ್ಯೆಯನ್ನು ಕಳುಹಿಸಿ:\n{list}',
    te: '{staff} తో అందుబాటులో ఉన్న సమయాలు. సంఖ్యను పంపండి:\n{list}',
  },
  askName: {
    en: "Almost done. What is the patient's full name? (You can add a phone number too.)",
    ta: 'கிட்டத்தட்ட முடிந்தது. நோயாளியின் முழுப் பெயர் என்ன? (தொலைபேசி எண்ணையும் சேர்க்கலாம்.)',
    hi: 'लगभग हो गया। मरीज़ का पूरा नाम क्या है? (फ़ोन नंबर भी जोड़ सकते हैं।)',
    kn: 'ಬಹುತೇಕ ಮುಗಿದಿದೆ. ರೋಗಿಯ ಪೂರ್ಣ ಹೆಸರು ಏನು? (ಫೋನ್ ಸಂಖ್ಯೆಯನ್ನೂ ಸೇರಿಸಬಹುದು.)',
    te: 'దాదాపు పూర్తయింది. రోగి పూర్తి పేరు ఏమిటి? (ఫోన్ నంబర్ కూడా జోడించవచ్చు.)',
  },
  booked: {
    en: '✅ Booked: {staff}, {when}. Token {token}. Your visit page (live waiting time and check-in): {link}',
    ta: '✅ முன்பதிவு உறுதி: {staff}, {when}. டோக்கன் {token}. உங்கள் வருகைப் பக்கம் (நேரடி காத்திருப்பு நேரம், செக்-இன்): {link}',
    hi: '✅ बुक हो गया: {staff}, {when}। टोकन {token}। आपका विज़िट पेज (लाइव प्रतीक्षा समय और चेक-इन): {link}',
    kn: '✅ ಬುಕ್ ಆಗಿದೆ: {staff}, {when}. ಟೋಕನ್ {token}. ನಿಮ್ಮ ಭೇಟಿ ಪುಟ (ನೇರ ಕಾಯುವ ಸಮಯ, ಚೆಕ್-ಇನ್): {link}',
    te: '✅ బుక్ అయింది: {staff}, {when}. టోకెన్ {token}. మీ విజిట్ పేజీ (లైవ్ వేచి ఉండే సమయం, చెక్-ఇన్): {link}',
  },
  noSlots: {
    en: 'Sorry, there are no free slots in the next few days. I have asked our front desk to call you.',
    ta: 'மன்னிக்கவும், அடுத்த சில நாட்களில் நேரம் இல்லை. எங்கள் வரவேற்பாளர் உங்களை அழைப்பார்.',
    hi: 'माफ़ करें, अगले कुछ दिनों में कोई खाली समय नहीं है। हमारी टीम आपको कॉल करेगी।',
  },
  bookingCancelled: {
    en: 'No problem, I have stopped the booking. Ask me anytime.',
    ta: 'சரி, முன்பதிவை நிறுத்திவிட்டேன். எப்போது வேண்டுமானாலும் கேளுங்கள்.',
    hi: 'कोई बात नहीं, बुकिंग रोक दी है। कभी भी पूछें।',
  },
  pickNumber: {
    en: 'Please reply with one of the numbers above, or "stop" to cancel.',
    ta: 'மேலே உள்ள எண்களில் ஒன்றை அனுப்பவும், ரத்து செய்ய "stop" என்று அனுப்பவும்.',
    hi: 'कृपया ऊपर दिए नंबरों में से एक भेजें, या रद्द करने के लिए "stop" लिखें।',
  },
  checkedIn: {
    en: "You're checked in. Token {token}, {ahead} ahead of you. Estimated wait: about {eta} minutes. We'll update you if it changes.",
    ta: 'செக்-இன் ஆகிவிட்டது. டோக்கன் {token}, உங்களுக்கு முன் {ahead} பேர். காத்திருப்பு சுமார் {eta} நிமிடங்கள். மாற்றம் இருந்தால் தெரிவிப்போம்.',
    hi: 'आपका चेक-इन हो गया। टोकन {token}, आपसे पहले {ahead} लोग। अनुमानित प्रतीक्षा: लगभग {eta} मिनट। बदलाव होने पर बताएँगे।',
    kn: 'ಚೆಕ್-ಇನ್ ಆಗಿದೆ. ಟೋಕನ್ {token}, ನಿಮ್ಮ ಮುಂದೆ {ahead} ಜನ. ಅಂದಾಜು ಕಾಯುವಿಕೆ ಸುಮಾರು {eta} ನಿಮಿಷ.',
    te: 'చెక్-ఇన్ అయింది. టోకెన్ {token}, మీ ముందు {ahead} మంది. అంచనా వేచి ఉండే సమయం సుమారు {eta} నిమిషాలు.',
  },
  queueStatus: {
    en: 'Token {token}: {ahead} ahead of you. Estimated wait: about {eta} minutes.',
    ta: 'டோக்கன் {token}: உங்களுக்கு முன் {ahead} பேர். காத்திருப்பு சுமார் {eta} நிமிடங்கள்.',
    hi: 'टोकन {token}: आपसे पहले {ahead} लोग। अनुमानित प्रतीक्षा: लगभग {eta} मिनट।',
    kn: 'ಟೋಕನ್ {token}: ನಿಮ್ಮ ಮುಂದೆ {ahead} ಜನ. ಅಂದಾಜು ಕಾಯುವಿಕೆ ಸುಮಾರು {eta} ನಿಮಿಷ.',
    te: 'టోకెన్ {token}: మీ ముందు {ahead} మంది. అంచనా వేచి ఉండే సమయం సుమారు {eta} నిమిషాలు.',
  },
  noAppointment: {
    en: "I couldn't find an appointment for today on this chat. Would you like to book one? Just say \"book appointment\".",
    ta: 'இந்த உரையாடலில் இன்றைய முன்பதிவு எதுவும் இல்லை. முன்பதிவு செய்ய "appointment" என்று அனுப்பவும்.',
    hi: 'इस चैट पर आज की कोई अपॉइंटमेंट नहीं मिली। बुक करने के लिए "appointment" लिखें।',
  },
  followupThanks: {
    en: 'Thank you for letting us know. Take care, and reply here anytime.',
    ta: 'தெரிவித்ததற்கு நன்றி. உடல்நலம் கவனித்துக்கொள்ளுங்கள்.',
    hi: 'बताने के लिए धन्यवाद। अपना ध्यान रखें।',
  },
  followupWorse: {
    en: "I'm sorry to hear that. I've informed your doctor's team and someone will contact you shortly. If it's urgent, call {number}.",
    ta: 'கேட்க வருத்தமாக உள்ளது. உங்கள் மருத்துவர் குழுவுக்குத் தெரிவித்துவிட்டேன், விரைவில் தொடர்புகொள்வார்கள். அவசரம் என்றால் {number} அழைக்கவும்.',
    hi: 'यह सुनकर दुख हुआ। आपके डॉक्टर की टीम को सूचित कर दिया है, वे जल्द संपर्क करेंगे। ज़रूरी हो तो {number} पर कॉल करें।',
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
  /\b(human|agent|person|representative|real person|someone real|talk to (a )?(human|person|someone)|customer care|manager|supervisor|insaan|receptionist|front desk)\b|इंसान|एजेंट|किसी व्यक्ति|ಮನುಷ್ಯ|ವ್ಯಕ್ತಿಯೊಂದಿಗೆ|ಏಜೆಂಟ್|மனிதர்|முகவர்/i;

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
