import type { MessageKey } from './en';

export const am: Record<MessageKey, string> = {
  // Navigation
  'nav.board': 'ትዕዛዞች',
  'nav.new': 'አዲስ ትዕዛዝ',
  'nav.deliveries': 'የኔ ማድረሻዎች',
  'nav.customers': 'ደንበኞች',
  'nav.catalog': 'ሜኑ እና እቃዎች',
  'nav.reports': 'ሪፖርቶች',
  'nav.more': 'ተጨማሪ',

  // Common UI
  'common.appName': 'ኦርደር ዴስክ',
  'common.offline': 'ከመስመር ውጭ። ለውጦች በዚህ ስልክ ላይ ተቀምጠዋል።',
  'common.saving': 'በዚህ ስልክ ላይ በማስቀመጥ ላይ...',
  'common.savedLocally': 'በዚህ ስልክ ላይ ተቀምጧል',
  'common.tryAgain': 'እንደገና ይሞክሩ',
  'common.cancel': 'ይቅር',
  'common.undo': 'መልስ',
  'common.back': 'ተመለስ',
  'common.next': 'ቀጣይ',
  'common.save': 'አስቀምጥ',
  'common.loading': 'በመጫን ላይ...',

  // Authentication
  'auth.signIn': 'ግባ',
  'auth.signUp': 'አካውንት ክፈት',
  'auth.email': 'ኢሜይል አድራሻ',
  'auth.password': 'የይለፍ ቃል (ቢያንስ 10 ፊደላት)',
  'auth.name': 'ሙሉ ስም',
  'auth.switchSignIn': 'አካውንት አለዎት? ይግቡ',
  'auth.switchSignUp': 'አካውንት የለዎትም? አዲስ ይክፈቱ',
  'auth.submit': 'ቀጥል',

  // Onboarding (Fixed layout)
  'onboarding.title': 'የንግድዎን መገለጫ ያዘጋጁ',
  'onboarding.step1Title': '1. የንግድ መገለጫ',
  'onboarding.step2Title': '2. ሜኑ እና አገልግሎቶች',
  'onboarding.step3Title': '3. ለመጀመር ዝግጁ',
  'onboarding.businessType': 'የንግዱ አይነት',
  'onboarding.typeFood': 'ምግብ እና መጠጥ (ሬስቶራንት፣ ካፌ)',
  'onboarding.typeDelivery': 'የማድረስ እና የፖስታ አገልግሎት',
  'onboarding.typeRepair': 'የጥገና ስራ',
  'onboarding.shopName': 'የሱቅ ወይም የንግድ ስም',
  'onboarding.language': 'የቋንቋ ምርጫ',
  'onboarding.sampleMenu': 'ናሙና እቃዎች (ሊስተካከሉ የሚችሉ)',
  'onboarding.readyTitle': 'ሁሉም ነገር ተዘጋጅቷል!',
  'onboarding.readyDesc': 'የሱቅዎ መገለጫ ለስራዎ በሚመጥኑ ቅንብሮች ተዘጋጅቷል።',
  'onboarding.finish': 'የመጀመሪያ ትዕዛዝ ይፍጠሩ',

  // Join Shop with Code
  'join.title': 'ቡድን ይቀላቀሉ',
  'join.desc': 'በሱቁ ባለቤት የተሰጠዎትን ባለ 16-ፊደል የመጋበዣ ኮድ ያስገቡ።',
  'join.code': 'የመጋበዣ ኮድ',
  'join.submit': 'ሱቁን ተቀላቀል',
  'join.success': '{shopName} በተሳካ ሁኔታ ተቀላቅለዋል።',

  // Catalog
  'catalog.title': 'ሜኑ እና እቃዎች',
  'catalog.addItem': 'አዲስ እቃ ጨምር',
  'catalog.name': 'የእቃው ወይም የአገልግሎቱ ስም',
  'catalog.price': 'ዋጋ (ብር)',
  'catalog.category': 'ምድብ',
  'catalog.available': 'አለ',
  'catalog.unavailable': 'አልቋል',
  'catalog.allCategories': 'ሁሉም እቃዎች',
  'catalog.empty': 'ምንም እቃዎች አልተገኙም። ከላይ አዲስ እቃ ይጨምሩ።',

  // Customers
  'customers.title': 'ደንበኞች',
  'customers.searchPlaceholder': 'በስልክ ወይም በስም ፈልግ...',
  'customers.searchPrompt': 'ለመፈለግ ቢያንስ 2 ፊደላትን ያስገቡ',
  'customers.addCustomer': 'ደንበኛ መዝግብ',
  'customers.name': 'ሙሉ ስም',
  'customers.phone': 'ስልክ ቁጥር',
  'customers.note': 'ማስታወሻ / አድራሻ',
  'customers.empty': 'ምንም ደንበኞች አልተገኙም።',

  // Errors: never expose codes, SQL, stack traces, or technical jargon
  'err.FORBIDDEN': 'ይህን እርምጃ ለመፈፀም ፈቃድ የለዎትም።',
  'err.NOT_FOUND': 'የተጠየቀው መረጃ አልተገኘም።',
  'err.VALIDATION': 'እባክዎ መረጃዎን ፈትሸው እንደገና ይሞክሩ።',
  'err.CONFLICT': 'ይህ ትዕዛዝ በሌላ ሰው ተቀይሯል። የቅርቡ መረጃ እየታየ ነው።',
  'err.INVALID_TRANSITION': 'ይህ የሁኔታ ለውጥ ለዚህ ትዕዛዝ አይፈቀድም።',
  'err.OVERPAYMENT': 'የተከፈለው መጠን ካለበት ቀሪ ሂሳብ ይበልጣል።',
  'err.RATE_LIMITED': 'ሙከራዎች በዝተዋል። እባክዎ ጥቂት ቆይተው እንደገና ይሞክሩ።',
  'err.SESSION_EXPIRED': 'የመግቢያ ጊዜዎ አልቋል። እባክዎ እንደገና ይግቡ።',
  'err.OFFLINE': 'ከመስመር ውጭ ነዎት። ለውጦች በዚህ ስልክ ተቀምጠው መስመር ሲገኝ ይላካሉ።',
  'err.AI_UNAVAILABLE': 'ረዳቱ በአሁኑ ጊዜ አይሰራም። በእጅ መስራት ይችላሉ።',
  'err.UNKNOWN': 'ስህተት ተከስቷል። ስራዎ በዚህ ስልክ ተቀምጧል። እንደገና ይሞክሩ።',
  'err.LIMIT_EXCEEDED': 'የተፈቀደው ከፍተኛ ገደብ አልቋል።',
  'err.DUPLICATE': 'ይህ መረጃ ቀደም ሲል ተመዝግቧል።',
};
