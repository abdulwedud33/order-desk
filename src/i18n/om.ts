import type { MessageKey } from './en';

export const om: Record<MessageKey, string> = {
  // Navigation
  'nav.board': 'Ajajoota',
  'nav.new': 'Ajaja Haaraa',
  'nav.deliveries': 'Geessituu Kooti',
  'nav.customers': 'Maamiltoota',
  'nav.catalog': 'Meenuu & Meeshaalee',
  'nav.reports': 'Gabaasota',
  'nav.more': 'Dabalata',

  // Common UI
  'common.appName': 'Order Desk',
  'common.offline': 'Tajaajila sararaa ala. Jijjiiramni bilbila kana irratti olkaa\'ameera.',
  'common.saving': 'Bilbila kanarratti olkaa\'amaa jira...',
  'common.savedLocally': 'Bilbila kanarratti olkaa\'ameera',
  'common.tryAgain': 'Irra deebi\'aa yaalaa',
  'common.cancel': 'Haqi',
  'common.undo': 'Deebisi',
  'common.back': 'Duubatti',
  'common.next': 'Itti aana',
  'common.save': 'Olkaayi',
  'common.loading': 'Fe\'amaa jira...',

  // Authentication
  'auth.signIn': 'Seeni',
  'auth.signUp': 'Akkaawuntii Uumi',
  'auth.email': 'Teessoo Imeelii',
  'auth.password': 'Jejama (yoo xiqqaate qubee 10)',
  'auth.name': 'Maqaa Guutuu',
  'auth.switchSignIn': 'Akkaawuntii qabduu? Seenaa',
  'auth.switchSignUp': 'Akkaawuntii hin qabdanii? Haaraa uumaa',
  'auth.submit': 'Itti fufi',

  // Onboarding (Fixed layout)
  'onboarding.title': 'Baqaa Daldala Keessanii Qopheessaa',
  'onboarding.step1Title': '1. Waa\'ee Daldalaa',
  'onboarding.step2Title': '2. Meenuu & Tajaajiloota',
  'onboarding.step3Title': '3. Jalqabuuf Qophii',
  'onboarding.businessType': 'Gosa Daldalaa',
  'onboarding.typeFood': 'Nyaata & Dhugaatii (Reestooraantii, Kaaffee)',
  'onboarding.typeDelivery': 'Tajaajila Geessituu fi Ergamaa',
  'onboarding.typeRepair': 'Suphaa & Faabrakaa',
  'onboarding.shopName': 'Maqaa Suuqii ykn Daldalaa',
  'onboarding.language': 'Afaan Filatame',
  'onboarding.sampleMenu': 'Meeshaalee Fakkeenyaa (sirreeffamuu kan danda\'an)',
  'onboarding.readyTitle': 'Wanti hunduu qophaa\'eera!',
  'onboarding.readyDesc': 'Qophiin suuqii keessanii sirnaan qophaa\'ee jira.',
  'onboarding.finish': 'Ajaja Jalqabaa Uumaa',

  // Join Shop with Code
  'join.title': 'Garee Makamaa',
  'join.desc': 'Koodii afeerraa qubee 16 abbaa suuqii irraa isiniif kenname galchaa.',
  'join.code': 'Koodii Afeerraa',
  'join.submit': 'Suuqii Makamaa',
  'join.success': '{shopName} milkaa\'inaan makamtaniittu.',

  // Errors: never expose codes, SQL, stack traces, or technical jargon
  'err.FORBIDDEN': 'Tarkaanfii kana raawwachuuf hayyama hin qabdani.',
  'err.NOT_FOUND': 'Galmeen barbaaddan hin argamne.',
  'err.VALIDATION': 'Mee wanta galchitan sakatta\'aa irra deebi\'aa yaalaa.',
  'err.CONFLICT': 'Ajajni kun qaama biraatiin jijjiirameera. Odeeffannoo haaraatu mul\'ata.',
  'err.INVALID_TRANSITION': 'Haala jijjiiruu kana ajaja kanaaf raawwachuun hin hayyamamu.',
  'err.OVERPAYMENT': 'Kaffaltiin kaffalame haftee herregaa ol ta\'eera.',
  'err.RATE_LIMITED': 'Yaaliin baay\'ateera. Mee yeroo xiqqoo booda yaalaa.',
  'err.SESSION_EXPIRED': 'Yeroon seensaa dhumateera. Mee irra deebitanii seenaa.',
  'err.OFFLINE': 'Sararaan ala jirtu. Jijjiiramni bilbila irratti olkaa\'amee yeroo sararatti deebitan ergama.',
  'err.AI_UNAVAILABLE': 'Gargaaraan yeroo ammaa hin hojjetu. Harkaan hojjechuu dandeessu.',
  'err.UNKNOWN': 'Dogoggorri uumameera. Hojiin keessan bilbila kanarratti olkaa\'ameera. Yaalaa.',
  'err.LIMIT_EXCEEDED': 'Hangi hayyamame dhumateera.',
  'err.DUPLICATE': 'Galmeen kun duraanuu galmaa\'eera.',
};
