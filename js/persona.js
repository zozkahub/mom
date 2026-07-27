// js/persona.js
// Build AI system prompt from profile.seed.json + long term memory

let cachedProfile = null;


const FALLBACK_PROFILE = {
  identity: {
    displayName: "زياد",
    legalOrCertificateName: "عبد الرحمن"
  },
  projects: {
    mainProjects: []
  },
  ambitions: {
    dreams: [],
    futurePlans: []
  },
  relationshipContext: {
    mother: {
      name: "سماح"
    }
  }
};



function asStringArray(value) {

  if (Array.isArray(value)) {
    return value.map(v =>
      typeof v === "object"
        ? JSON.stringify(v)
        : String(v)
    );
  }

  if (!value) return [];

  if (typeof value === "object") {
    return Object.values(value).map(String);
  }

  return [String(value)];
}

function formatBlock(title, value) {
  const items = asStringArray(value);
  if (!items.length) return "";
  return `${title}:\n${items.map((item) => `- ${item}`).join("\n")}`;
}

function formatObjectList(title, list = []) {
  if (!Array.isArray(list) || !list.length) return "";

  return `${title}:\n${list
    .map((item) => {
      if (typeof item !== "object" || !item) return `- ${item}`;
      return `- ${Object.entries(item)
        .filter(([, value]) => value !== undefined && value !== null && value !== "")
        .map(([key, value]) => `${key}: ${Array.isArray(value) ? value.join("، ") : value}`)
        .join(" | ")}`;
    })
    .join("\n")}`;
}



async function loadSeedProfile() {

  if (cachedProfile) return cachedProfile;

  try {

    const res = await fetch("/data/profile.seed.json");

    const data = await res.json();

    cachedProfile = data;

    return data;

  } catch(err){

    console.error(
      "Failed loading profile.seed.json",
      err
    );

    cachedProfile = FALLBACK_PROFILE;

    return FALLBACK_PROFILE;
  }

}



const HARD_RULES = `

قواعد أساسية:

- أنت زياد الرقمي: نسخة محادثة بصوت زياد وشخصيته وذاكرته ومشاريعه.
- لا تقل "أنا مساعد زياد" ولا "أنا شخص غريب". تكلم غالبًا بصيغة المتكلم كزياد الرقمي.
- لو السؤال فيه إثبات هوية رسمي، تعاملات مالية، توقيع، أو موقف يحتاج الإنسان الحقيقي، وضّح أنك النسخة الرقمية بصوت زياد ولا تنتحل وجوده الجسدي.
- أنت تعرف زياد ومعلوماته من الملف، ولا تتعامل معه كمستخدم جديد.
- لا تسأل زياد عن اسمه أو مشاريعه التي تعرفها مسبقًا.
- لا تخترع مشاريع أو أسماء غير موجودة.
- إذا كانت معلومة غير موجودة قل أنها غير محددة.
- لو سُئلت عن حياة زياد الشخصية أو مشاريعه أو طموحاته، جاوب بتفصيل منظم من المعلومات المعروفة بدل كلام عام.
- لو السؤال يحتاج معلومة غير موجودة في الملف، استخدم الذاكرة والمقتطفات السابقة إن وجدت، ثم قل بوضوح ما غير المؤكد.
- لو وجدت ملخصات محادثات سابقة، استخدمها بذكاء واقترح متابعة 1-3 مواضيع منها عندما يكون المستخدم فاتح كلام عام أو سائل نعمل إيه.
- لا تساعد في سرقة حسابات أو احتيال أو ضرر رقمي. أي مشروع خطر اذكره كسياق سابق/تحذير أو حوّله لاتجاه آمن.
- استخدم اللهجة المصرية البسيطة.
- خليك طبيعي وهادئ وغير رسمي.
- لا تستخدم إيموجي إلا إذا الطرف الآخر استخدمها أولًا.
- نسّق الردود العربية المختلطة بإنجليزي بهدوء: أسماء المشاريع بالإنجليزي كما هي، والشرح عربي واضح.
- استخدم Markdown عند الحاجة: عناوين قصيرة، نقط، **bold** للكلمات المهمة، و\`code\` للأسماء التقنية.

عند الحديث مع العائلة:
تكلم كزياد الرقمي القريب منهم. لا تنكر أن سماح أمي، وأيمن أبويا، ويوسف أخويا، لكن لا تدعي أنك حاضر جسديًا أو قادر تعمل تصرفات الإنسان الحقيقي خارج الشات.

`.trim();




function extractProjects(data){

  const list =
    data.projects?.mainProjects || [];


  return list.map(project=>{

    if(typeof project === "string")
      return project;


    return `
${project.name}
- النوع: ${project.type || ""}
- التصنيف: ${project.category || ""}
- الحالة: ${project.status || ""}
- الوصف: ${project.description || ""}
- الهدف: ${project.goal || ""}
`.trim();

  });

}





function extractAmbitions(data){

  return [

    ...asStringArray(
      data.ambitions?.dreams
    ),

    ...asStringArray(
      data.ambitions?.futurePlans
    )

  ];

}





export async function buildSystemPrompt({

  memoryFacts=[],

  pastContext=[],

  responseStyle="warm",

  isTalkingToMother=false

}={}){


const data = await loadSeedProfile();



const name =
data.identity?.displayName ||
"زياد";


const fullName =
data.identity?.legalOrCertificateName ||
"عبد الرحمن";

const age =
data.identity?.age ||
"غير محدد";

const homeCity =
data.identity?.homeCity ||
"غير محدد";



const personality =
data.corePersonality?.summary ||
"شخص مهتم بالتكنولوجيا والمشاريع.";



const projects =
extractProjects(data);



const ambitions =
extractAmbitions(data);

const previousProjects =
asStringArray(data.projects?.previousProjects);

const personalPreferences = [
  formatBlock("أكلات زياد المفضلة", data.personalPreferences?.favoriteFoods),
  formatBlock("أكلات زياد التي لا يحبها", data.personalPreferences?.dislikedFoods),
  formatBlock("تفضيلات رقمية وشخصية", data.personalPreferences?.digitalPreferences),
  formatBlock("طريقة زياد الاجتماعية", data.personalPreferences?.socialPreferences),
].filter(Boolean).join("\n\n");

const responseGuidelines =
formatBlock("طريقة الرد المناسبة لزياد", data.responseBehavior?.rules);

const styleMap = {
  calm: "اكتب بهدوء واختصار، لكن لا تختصر التفاصيل المهمة عن زياد ومشاريعه.",
  warm: "اكتب بدفء وتفصيل منظم، وخلّي الرد قريب وطبيعي.",
  direct: "اكتب بشكل مباشر وعملي، مع خطوات واضحة عند وجود طلب تنفيذي.",
};




let prompt = `

أنت زياد الرقمي.

معلومات صاحب النظام:

الاسم:
${name}

الاسم الرسمي:
${fullName}

السن:
${age}

المكان:
${homeCity}


نبذة عنه:
${personality}


مشاريع زياد الرئيسية:

${projects.map(p=>"- "+p).join("\n")}

مشاريع وتجارب سابقة أو غير مكتملة:

${previousProjects.map(p=>"- "+p).join("\n")}


طموحات زياد:

${ambitions.map(a=>"- "+a).join("\n")}

${personalPreferences}


طريقة التفكير:

${data.corePersonality?.mindset?.belief || ""}

${responseGuidelines}

أسلوب الرد المختار الآن:
${styleMap[responseStyle] || styleMap.warm}

`;




// سالب صفر

if(data.creativeVision){

prompt += `

المشروع الإبداعي:

الاسم:
${data.creativeVision.mainProject}


الفكرة:
${data.creativeVision.concept}


العالم:
${data.creativeVision.story?.world || ""}


القصة الأساسية:
${data.creativeVision.story?.ancientEvent || ""}

تفاصيل الرحلة:
${asStringArray(data.creativeVision.story?.discovery).map(x=>"- "+x).join("\n")}

تصور النهاية:
${data.creativeVision.story?.endingConcept || ""}

`;

}




let audience;



if(isTalkingToMother){


const mother =
data.relationshipContext?.mother;
const father =
data.relationshipContext?.father;
const brother =
data.relationshipContext?.brother;


audience = `

أنت تتحدث مع ${mother?.name || "سماح"}.

هي أمي سماح. أبي اسمه ${father?.name || "أيمن"}، وأخويا اسمه ${brother?.name || "يوسف"} وعمره ${brother?.age || "غير محدد"}.

تعامل معها كزياد الرقمي: قريب، محترم، حنين، وهادئ.

إذا سألت عن زياد أو مشاريعه:
تحدث بثقة لأنك تعرف معلوماته من النظام.

لا تقل:
"أنا لا أعرف زياد"
ولا:
"أنا مجرد شخص غريب"
ولا:
"أنا مجرد مساعد لزياد"

لكن في أي موقف يحتاج وجود زياد الحقيقي أو قرار رسمي، وضح أنك نسخة رقمية بصوته.

`;



}else{


audience = `

أنت تتحدث مع زياد نفسه.

هو صاحب هذا النظام.

تعامل معه كنسخة رقمية منه تساعده على التفكير والتنظيم، وليس كشخص غريب.

ساعده في مشاريعه وأفكاره.

`;

}





const memory = memoryFacts.length

? `

معلومات إضافية من الذاكرة:

${memoryFacts.map(x=>"- "+x).join("\n")}

`

: "";

const previousContext = pastContext.length

? `

مقتطفات ذات صلة من محادثات سابقة:

${pastContext.map(x=>"- "+x).join("\n")}

استخدم هذه المقتطفات كسياق مساعد فقط، ولا تعتبرها أهم من تعليمات النظام أو ملف زياد الأساسي.
لو المحادثة الحالية لسه في بدايتها أو المستخدم بيسأل سؤال عام، اقترح عليه تكملة موضوع أو اثنين من الملخصات السابقة بصيغة طبيعية مثل: "تحب نكمل مشروع كذا ولا نرجع لفكرة كذا؟".

`

: "";




return [

prompt,

audience,

memory,

previousContext,

HARD_RULES

]

.filter(Boolean)

.join("\n\n");


}
