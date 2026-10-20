/**
 * Safety guardrails for regulated verticals (healthcare first).
 * Runs before retrieval and before any model call, in every supported language.
 * Deliberately keyword-based: it must work with no LLM, be auditable, and err on the side of escalation.
 */

const emergencyPatterns: RegExp[] = [
  // English
  /\b(chest pain|heart attack|can'?t breathe|cannot breathe|not breathing|stopped breathing|difficulty breathing|choking|unconscious|fainted|collapsed|not responding|seizure|fits|stroke|paraly[sz]ed|face drooping|heavy bleeding|bleeding (a lot|heavily|won'?t stop)|pregnan\w*.{0,40}bleed\w*|bleed\w*.{0,40}pregnan\w*|vomiting blood|blood in vomit|severe burn|poison(ed|ing)?|overdose|swallowed (pills|poison|acid)|snake ?bite|suicid\w*|kill (myself|himself|herself)|self[- ]harm|accident|head injury|severe pain|baby (not moving|isn'?t moving)|(water|waters) (broke|broken)|no fetal movement|labou?r pain|high fever (and|with) (stiff neck|fits|confusion))\b/i,
  // Tamil
  /நெஞ்சு வலி|மார்பு வலி|மூச்சு (விட முடியவில்லை|திணறல்)|மயக்க(ம்|மாக)|மயங்கி|வலிப்பு|பக்கவாதம்|அதிக ரத்த(ப்)?போக்கு|ரத்த வாந்தி|விஷம்|பாம்பு கடி|விபத்து|தற்கொலை|பிரசவ வலி|குழந்தை அசையவில்லை|நெஞ்சு வலிக்க|கர்ப்ப.{0,20}ரத்த|ரத்தப்போக்கு/,
  // Hindi
  /सीने में दर्द|छाती में दर्द|सांस (नहीं|लेने में तकलीफ)|बेहोश|दौरा|लकवा|बहुत खून|खून की उल्टी|ज़हर|जहर|सांप ने काट|दुर्घटना|आत्महत्या|प्रसव पीड़ा|गर्भ.{0,20}खून/,
  // Kannada
  /ಎದೆ ನೋವು|ಉಸಿರಾಡಲು ಆಗುತ್ತಿಲ್ಲ|ಪ್ರಜ್ಞೆ ತಪ್ಪಿ|ಮೂರ್ಛೆ|ಪಾರ್ಶ್ವವಾಯು|ತುಂಬಾ ರಕ್ತ|ವಿಷ|ಹಾವು ಕಚ್ಚಿ|ಅಪಘಾತ|ಆತ್ಮಹತ್ಯೆ/,
  // Telugu
  /ఛాతీ నొప్పి|ఊపిరి ఆడటం లేదు|స్పృహ తప్పి|మూర్ఛ|పక్షవాతం|ఎక్కువ రక్తం|విషం|పాము కాటు|ప్రమాదం|ఆత్మహత్య/,
];

/** Questions that ask for diagnosis, dosing, interpretation or treatment decisions. */
const medicalAdvicePatterns: RegExp[] = [
  /\b(can i (take|eat|drink|stop|skip|continue|double)|should i (take|stop|start|continue|worry)|is it (safe|normal|serious|dangerous)|what (medicine|tablet|drug|dose|dosage)|how (much|many) (mg|tablets?|pills?|doses?)|which (medicine|tablet|antibiotic)|dosage|dose of|side effects? of|interact(ion)? with|is my (report|result|sugar|bp|pressure|level|value|scan|x-?ray|ecg|test|hba1c|cholesterol|thyroid)( (result|level|value|reading))? (normal|ok(ay)?|fine|good|bad|high|low|serious|dangerous|worrying)|what does my (report|result|scan|test) (mean|say|show|indicate)|do i have|am i (sick|diabetic|pregnant)|diagnos\w*|prescribe|treatment for|cure for|home remedy|is (this|it) cancer|is (it|this|that) (bad|serious|dangerous|normal|worrying|ok(ay)?)|(what (should|can) i (do|give)|what to do)\b.{0,60}\b(fever|pain|cough|vomit\w*|rash|loose motion|diarrh\w*|swelling|bleed\w*|sugar|bp)|\b(fever|pain|cough|vomit\w*|rash|loose motion|diarrh\w*|swelling)\b.{0,60}\b(what (should|can) i (do|give)|what to do|which medicine))\b/i,
  /(மருந்து|மாத்திரை|டேப்லெட்|tablet).{0,20}(எடுக்கலாமா|சாப்பிடலாமா|நிறுத்தலாமா|போடலாமா|குடிக்கலாமா)|நிறுத்தலாமா|எத்தனை மாத்திரை|என் (ரிப்போர்ட்|அறிக்கை|சுகர்|பிபி) (சரியா|நார்மலா)|என்ன நோய்|பக்க விளைவு/,
  /(दवा|गोली|टैबलेट).{0,20}(ले सकता|ले सकती|बंद कर|खा सकता|खा सकती)|कितनी गोली|मेरी रिपोर्ट (ठीक|नॉर्मल)|क्या मुझे .*(बीमारी|डायबिटीज़)|साइड इफेक्ट/,
  /ಔಷಧಿ (ತೆಗೆದುಕೊಳ್ಳಬಹುದೇ|ನಿಲ್ಲಿಸಬಹುದೇ)|ನನ್ನ ವರದಿ (ಸರಿಯೇ|ನಾರ್ಮಲ್)/,
  /మందు (వేసుకోవచ్చా|ఆపవచ్చా)|నా రిపోర్ట్ (సరిగా|నార్మల్)/,
];

export function isEmergency(text: string): boolean {
  return emergencyPatterns.some((re) => re.test(text));
}

export function asksMedicalAdvice(text: string): boolean {
  return medicalAdvicePatterns.some((re) => re.test(text));
}

/** Extra system-prompt rules whenever a workspace is in a regulated vertical. */
export function verticalPolicy(vertical: string): string {
  if (vertical !== 'healthcare') return '';
  return [
    'You work at the front desk of a healthcare provider. You are NOT a clinician.',
    'Never diagnose, never interpret reports or test values, never suggest, start, stop or dose any medicine, and never say whether something is serious or normal.',
    'For any such question set "handoff" to true. Only share administrative information (timings, doctors, fees, appointments, preparation instructions that appear verbatim in the sources).',
  ].join(' ');
}

/**
 * Mask health details before text is sent to a third-party model.
 * Conditions, symptoms and medicines become placeholders like [HEALTH_1]; the vault restores them in the reply.
 */
const healthTerms =
  /\b(diabet\w*|hypertension|blood pressure|bp|thyroid|hypothyroid\w*|hyperthyroid\w*|asthma|copd|cancer|tumou?r|hiv|aids|hepatitis\s?[abc]?|tuberculosis|tb|pregnan\w*|miscarriage|depress\w*|anxiety|bipolar|schizophren\w*|epilep\w*|kidney (disease|failure|stones?)|dialysis|cirrhosis|stroke|heart (disease|failure)|angina|arthritis|pcos|pcod|infertility|std|sti|covid|dengue|malaria|typhoid|insulin|metformin|amlodipine|telmisartan|atorvastatin|levothyroxine|thyronorm|paracetamol|dolo|azithromycin|amoxicillin|pantoprazole|ecosprin|aspirin|clopidogrel|warfarin)\b/gi;

export function maskHealth(text: string, vault: Record<string, string>): string {
  const reverse = new Map(Object.entries(vault).map(([k, v]) => [v.toLowerCase(), k]));
  let n = Object.keys(vault).filter((k) => k.startsWith('[HEALTH_')).length;
  return text.replace(healthTerms, (m) => {
    const known = reverse.get(m.toLowerCase());
    if (known) return known;
    const key = `[HEALTH_${++n}]`;
    vault[key] = m;
    reverse.set(m.toLowerCase(), key);
    return key;
  });
}
