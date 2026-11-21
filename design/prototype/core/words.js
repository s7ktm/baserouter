// Words every skin shares, in both languages. A skin may override any key in its own strings.
// "{n}" inserts a value; "{n|route|routes}" inserts the value and the right word for it.
// Turkish strings never attach a suffix to an inserted name or number.

export const words = {
  en: {
    // home
    today: "today", thisMonth: "this month", copy: "Copy", copied: "Copied", newRoute: "New route", off: "Off",
    unreachable: "unreachable", working: "working", raiseBudget: "Raise budget", addProvider: "Add provider",
    home: "Home", routes: "Routes", providers: "Providers", activity: "Activity", settings: "Settings", status: "Status",
    ofBudget: "of {budget}", budgetLine: "{used} of {budget} budget", stoppedBudget: "Budget used up, stopped", full: "Full",
    details: "details", close: "Close", done: "Done", back: "Back", cancel: "Cancel", stepOf: "Step {n} of {of}",

    // route detail
    st_on: "On", st_busy: "On, working now", st_off: "Off", st_over: "Stopped: budget used up",
    budget: "Budget", resets: "Starts again on {date}", changeBudget: "Change budget", saveBudget: "Save budget",
    monthly: "Monthly budget in dollars", overNote: "This route is stopped until its budget is raised or the month ends.",
    connect: "Connect", address: "Address", key: "Key",
    keyNote: "The full key is shown once, when it is made. If it is lost, make a new one.", newKey: "Make a new key",
    models: "Models", modelsNote: "Tried in this order: if the first fails, the next one is used.", addModel: "Add model", remove: "Remove {name}",
    recent: "Recent requests", noRecent: "No requests yet.", allActivity: "All activity", failed: "failed", deleteRoute: "Delete route",
    agoS: "{n} s ago", agoM: "{n} min ago", agoH: "{n} h ago", agoD: "{n} d ago",

    // providers
    provNone: "No providers yet. Add one to start.",
    provUp: "Working. {n} models available.", provDown: "Unreachable. Last answer: {error}.",
    keyEnds: "Key ends in {hint}.", noKey: "No key needed.",
    testAgain: "Test again", removeProvider: "Remove", testingKey: "Testing the connection",
    addTitle: "Add a provider", pickSub: "Which one do you have a key for?",
    k_openrouter: "Hundreds of models through one key", k_openai: "GPT models", k_anthropic: "Claude models",
    k_google: "Gemini models", k_ollama: "Models that run on your own machine. No key.",
    k_custom: "Anything else that speaks the OpenAI format", customName: "Another service",
    pasteKey: "Paste your {name} key", whereKey: "You can make one at {where}.",
    keyStored: "It is stored encrypted on this machine and never shown in full again.",
    addressOf: "Address of {name}", testAdd: "Test and add",
    addOk: "{name} is connected. {n} models are available.",
    addFail: "The key was not accepted. {name} answered: {error}.",
    nextRoute: "Next: make a route",

    // new route
    routeName: "Name", routeNameHint: "What will use this route? For example: Home assistant",
    firstModel: "Model", modelLater: "You can add more models later.", makeRoute: "Make route",
    needProvider: "Add a provider first. A route needs at least one.",
    routeReady: "{name} is ready", keyOnce: "This is the only time the full key is shown. Copy it now.",
    tryIt: "Try it", waiting: "Waiting for the first request", arrived: "The first request arrived: {secs}, {cost}",

    // activity
    actSub: "{n|request|requests} today, {spent} spent", allRoutes: "All routes",
    actNone: "No requests yet. They appear here as soon as a route is used.", actNoneFor: "No requests on this route yet.",

    // settings
    look: "Look", theme: "Theme", light: "Light", dark: "Dark", auto: "Match device", language: "Language",
    password: "Password", changePassword: "Change password",
    yourData: "Your data", exportAll: "Export everything",
    exportNote: "Routes, providers without their keys, and the request log, in one file.",
    about: "About", aboutLine: "BaseRouter 0.1. Open source under the MIT licence.",
  },
  tr: {
    today: "bugün", thisMonth: "bu ay", copy: "Kopyala", copied: "Kopyalandı", newRoute: "Yeni rota", off: "Kapalı",
    unreachable: "ulaşılamıyor", working: "çalışıyor", raiseBudget: "Bütçeyi artır", addProvider: "Sağlayıcı ekle",
    home: "Ev", routes: "Rotalar", providers: "Sağlayıcılar", activity: "Hareketler", settings: "Ayarlar", status: "Durum",
    ofBudget: "/ {budget}", budgetLine: "{used} / {budget} bütçe", stoppedBudget: "Bütçe doldu, durduruldu", full: "Doldu",
    details: "ayrıntılar", close: "Kapat", done: "Tamam", back: "Geri", cancel: "Vazgeç", stepOf: "Adım {n} / {of}",

    st_on: "Açık", st_busy: "Açık, şimdi çalışıyor", st_off: "Kapalı", st_over: "Durduruldu: bütçe doldu",
    budget: "Bütçe", resets: "Yeniden başlama tarihi: {date}", changeBudget: "Bütçeyi değiştir", saveBudget: "Bütçeyi kaydet",
    monthly: "Aylık bütçe (dolar)", overNote: "Bütçe artırılana ya da ay bitene kadar bu rota durur.",
    connect: "Bağlan", address: "Adres", key: "Anahtar",
    keyNote: "Anahtarın tamamı yalnızca oluşturulduğunda gösterilir. Kaybolduysa yenisini oluştur.", newKey: "Yeni anahtar oluştur",
    models: "Modeller", modelsNote: "Bu sırayla denenir: ilki başarısız olursa sıradaki kullanılır.", addModel: "Model ekle", remove: "Kaldır: {name}",
    recent: "Son istekler", noRecent: "Henüz istek yok.", allActivity: "Bütün hareketler", failed: "başarısız", deleteRoute: "Rotayı sil",
    agoS: "{n} sn önce", agoM: "{n} dk önce", agoH: "{n} sa önce", agoD: "{n} gün önce",

    provNone: "Henüz sağlayıcı yok. Başlamak için bir tane ekle.",
    provUp: "Çalışıyor. {n} model kullanılabilir.", provDown: "Ulaşılamıyor. Son yanıt: {error}.",
    keyEnds: "Anahtarın sonu: {hint}.", noKey: "Anahtar gerekmiyor.",
    testAgain: "Yeniden test et", removeProvider: "Kaldır", testingKey: "Bağlantı test ediliyor",
    addTitle: "Sağlayıcı ekle", pickSub: "Hangisi için anahtarın var?",
    k_openrouter: "Tek anahtarla yüzlerce model", k_openai: "GPT modelleri", k_anthropic: "Claude modelleri",
    k_google: "Gemini modelleri", k_ollama: "Kendi bilgisayarında çalışan modeller. Anahtar gerekmez.",
    k_custom: "OpenAI biçimini konuşan başka bir servis", customName: "Başka bir servis",
    pasteKey: "{name} anahtarını yapıştır", whereKey: "Anahtarı şuradan oluşturabilirsin: {where}",
    keyStored: "Bu makinede şifreli saklanır ve bir daha tam olarak gösterilmez.",
    addressOf: "{name} adresi", testAdd: "Test et ve ekle",
    addOk: "{name} bağlandı. {n} model kullanılabilir.",
    addFail: "Anahtar kabul edilmedi. {name} yanıtı: {error}.",
    nextRoute: "Sıradaki: rota oluştur",

    routeName: "İsim", routeNameHint: "Bu rotayı ne kullanacak? Örneğin: Ev asistanı",
    firstModel: "Model", modelLater: "Sonradan başka modeller ekleyebilirsin.", makeRoute: "Rotayı oluştur",
    needProvider: "Önce bir sağlayıcı ekle. Rotanın en az bir sağlayıcıya ihtiyacı var.",
    routeReady: "{name} hazır", keyOnce: "Anahtarın tamamı yalnızca şimdi gösterilir. Şimdi kopyala.",
    tryIt: "Dene", waiting: "İlk istek bekleniyor", arrived: "İlk istek geldi: {secs}, {cost}",

    actSub: "Bugün {n} istek, {spent} harcandı", allRoutes: "Bütün rotalar",
    actNone: "Henüz istek yok. Bir rota kullanıldığında burada görünür.", actNoneFor: "Bu rotada henüz istek yok.",

    look: "Görünüm", theme: "Tema", light: "Açık", dark: "Koyu", auto: "Cihaza uy", language: "Dil",
    password: "Parola", changePassword: "Parolayı değiştir",
    yourData: "Verilerin", exportAll: "Hepsini dışa aktar",
    exportNote: "Rotalar, anahtarları olmadan sağlayıcılar ve istek kaydı, tek dosyada.",
    about: "Hakkında", aboutLine: "BaseRouter 0.1. MIT lisanslı açık kaynak.",
  },
};
