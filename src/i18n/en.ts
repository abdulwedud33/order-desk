export const en = {
  // Navigation
  'nav.board': 'Board',
  'nav.new': 'New Order',
  'nav.deliveries': 'My Deliveries',
  'nav.customers': 'Customers',
  'nav.catalog': 'Menu & Items',
  'nav.reports': 'Reports',
  'nav.more': 'More',

  // Common UI
  'common.appName': 'Order Desk',
  'common.offline': 'Offline. Changes are saved on this phone.',
  'common.saving': 'Saving on this phone...',
  'common.savedLocally': 'Saved on this phone',
  'common.tryAgain': 'Try again',
  'common.cancel': 'Cancel',
  'common.undo': 'Undo',
  'common.back': 'Back',
  'common.next': 'Next',
  'common.save': 'Save',
  'common.loading': 'Loading...',

  // Authentication
  'auth.signIn': 'Sign In',
  'auth.signUp': 'Create Account',
  'auth.email': 'Email address',
  'auth.password': 'Password (min 10 characters)',
  'auth.name': 'Full name',
  'auth.switchSignIn': 'Already have an account? Sign in',
  'auth.switchSignUp': "Don't have an account? Create one",
  'auth.submit': 'Continue',

  // Onboarding (Fixed layout)
  'onboarding.title': 'Set Up Your Business',
  'onboarding.step1Title': '1. Business Profile',
  'onboarding.step2Title': '2. Menu & Services',
  'onboarding.step3Title': '3. Ready to Launch',
  'onboarding.businessType': 'Business Type',
  'onboarding.typeFood': 'Food & Drinks (Restaurant, Cafe)',
  'onboarding.typeDelivery': 'Delivery & Courier Service',
  'onboarding.typeRepair': 'Repair & Workshop',
  'onboarding.shopName': 'Shop / Business Name',
  'onboarding.language': 'Display Language',
  'onboarding.sampleMenu': 'Sample Items (ready to customize)',
  'onboarding.readyTitle': 'Everything is ready!',
  'onboarding.readyDesc': 'Your shop profile is prepared with smart defaults for your business.',
  'onboarding.finish': 'Create First Order',

  // Join Shop with Code
  'join.title': 'Join a Team',
  'join.desc': 'Enter the 16-character invite code provided by your shop owner.',
  'join.code': 'Invite Code',
  'join.submit': 'Join Shop',
  'join.success': 'You have successfully joined {shopName}.',

  // Catalog
  'catalog.title': 'Menu & Services',
  'catalog.addItem': 'Add Item',
  'catalog.name': 'Item or Service Name',
  'catalog.price': 'Price (ETB)',
  'catalog.category': 'Category',
  'catalog.available': 'Available',
  'catalog.unavailable': "Unavailable (86'd)",
  'catalog.allCategories': 'All Items',
  'catalog.empty': 'No items found. Add your first item above.',

  // Customers
  'customers.title': 'Customers',
  'customers.searchPlaceholder': 'Search by phone or name...',
  'customers.searchPrompt': 'Type at least 2 characters to search',
  'customers.addCustomer': 'Add Customer',
  'customers.name': 'Full Name',
  'customers.phone': 'Phone Number',
  'customers.note': 'Customer Notes / Address',
  'customers.empty': 'No customers found.',

  // Errors: never expose codes, SQL, stack traces, or technical jargon
  'err.FORBIDDEN': 'You do not have permission to perform this action.',
  'err.NOT_FOUND': 'The requested record could not be found.',
  'err.VALIDATION': 'Please check your entries and try again.',
  'err.CONFLICT': 'This order was just updated by someone else. Showing the latest.',
  'err.INVALID_TRANSITION': 'This status change is not allowed for this order.',
  'err.OVERPAYMENT': 'Payment amount exceeds the outstanding balance.',
  'err.RATE_LIMITED': 'Too many attempts. Please wait a moment and try again.',
  'err.SESSION_EXPIRED': 'Your session has expired. Please sign in again.',
  'err.OFFLINE': 'You are offline. Your changes are saved on this phone and will sync when connected.',
  'err.AI_UNAVAILABLE': 'The assistant is currently unavailable. You can proceed manually.',
  'err.UNKNOWN': 'Something went wrong. Your work is saved on this phone. Try again.',
  'err.LIMIT_EXCEEDED': 'The limit for this operation has been reached.',
  'err.DUPLICATE': 'This entry already exists.',
};

export type MessageKey = keyof typeof en;
