# مساعد زياد — موقع شخصي بذاكرة دائمة

## ⚠️ أهم حاجة قبل أي حاجة تانية: المفتاح اللي بعتهولي

بعتلي مفتاح OpenRouter مكتوب في الرسالة (`sk-or-v1-...`). أي مفتاح بيتكتب في شات
بيتسجل تلقائيًا وبيبقى غير آمن من دلوقتي، حتى لو محدش شافه غيرك. **متستخدموش —**
روحي على https://openrouter.ai/keys واعملي **Revoke/Delete** له وطلعي مفتاح جديد.
المفتاح الجديد ده حطيه في Netlify (مش في أي ملف كود) زي ما هو موضح تحت. الكود هنا
مبنى بحيث المفتاح **مايتكتبش في أي ملف هيترفع على GitHub خالص** — بيتقرا وقت التشغيل
من Environment Variable.

## هيكل المشروع

```
index.html              الصفحة الرئيسية (ترحيب + دخول + شات)
css/style.css            التصميم
js/                       منطق الموقع (auth, chat, memory, persona)
data/profile.seed.json    بيانات البروفايل الأساسية اللي بيتبني منها أسلوب المساعد
netlify/functions/chat.js  السيرفر البسيط اللي بيكلم OpenRouter (فيه المفتاح كـ env var)
netlify.toml              إعدادات Netlify
```

## خطوات النشر

### 1. Firebase
المشروع مربوط بالفعل بإعدادات Firebase اللي بعتهالي (`js/firebase-config.js`).
مفتاح Firebase الظاهر هنا **طبيعي يكون عام** (client key)، الحماية الحقيقية
بتيجي من الخطوة اللي بعدها.

في [Firebase Console](https://console.firebase.google.com) لازم:
1. تفعّلي **Authentication → Sign-in method**: فعّلي Email/Password و Google.
2. تفعّلي **Firestore Database** (Production mode).
3. حطي الـ Security Rules دي في Firestore عشان كل حد يشوف بياناته بس:

```
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    match /users/{userId}/{document=**} {
      allow read, write:
        if request.auth != null
        && request.auth.uid == userId;
    }
  }
}
```

### 2. Netlify
1. ادفعي المشروع ده على GitHub (المفتاح مش موجود في أي ملف، فمفيش خطورة).
2. اربطي الـ repo بـ Netlify (New site from Git).
3. من **Site settings → Environment variables** ضيفي:
   - `OPENROUTER_API_KEY` = المفتاح الجديد اللي هتطلعيه بعد إلغاء القديم.
4. Deploy. الموقع هيشتغل على دومين `xxx.netlify.app`، وتقدري تضيفي دومين خاص من نفس الإعدادات.

### 3. تجربة محلية (اختياري)
لو عندك Netlify CLI:
```
npm install -g netlify-cli
netlify dev
```

## إزاي الذاكرة شغالة
- **قصيرة المدى**: آخر 16 رسالة في نفس المحادثة بتتبعت مع كل طلب.
- **طويلة المدى**: بعد كل رد، الموقع بيبعت آخر جزء من الكلام لنفس الـ AI ويطلب منه
  يستخرج بس الحقائق الثابتة (اسم، تفضيل، أسلوب) ويخزنها في Firestore تحت
  `users/{uid}/memory/profile`. تقدري تشوفيها أو توقفيها من صفحة الإعدادات.

## تبديل النماذج (fallback)
النماذج مرتبة في `netlify/functions/chat.js` (`MODEL_CHAIN`). لو موديل فشل أو
اتقفل، السيرفر بيجرب اللي بعده تلقائيًا. أسماء الموديلات المجانية على OpenRouter
بتتغير، فراجعي https://openrouter.ai/models?max_price=0 بين فترة وفترة وحدّثي القايمة.

## ملاحظة عن بيانات العيلة
سيبت تفاصيل حساسة (زي أي حالة نفسية لأي حد في العيلة) برا الكود عمدًا، لأن
المشروع هيتنشر عام على GitHub. لو عايز المساعد "يعرف" حاجة زيادة، تقدر تضيفها في
`data/profile.seed.json` — بس افتكر إن أي حاجة تحطها هناك هتبقى ظاهرة لأي حد يفتح
الـ repo.
