// Hong Kong Jobs for International Students (Non-Chinese Speaking)
// 50 jobs total: 30 English-friendly (🟢) + 20 Chinese/Cantonese required (no badge)

const jobs = [
  // ========== ENGLISH-FRIENDLY JOBS (🟢 BADGE) ==========
  {
    title: "Software Engineer",
    company: "Google",
    description: "Develop and maintain backend services. Work in English. Python, Java, or C++ required.",
    url: "https://careers.google.com",
    languages: "English",
    badge: "🟢",
    matchScore: null
  },
  {
    title: "Data Analyst",
    company: "HSBC",
    description: "Analyze financial data and create reports. SQL and Excel required. English workplace.",
    url: "https://hsbc.com/careers",
    languages: "English",
    badge: "🟢",
    matchScore: null
  },
  {
    title: "Frontend Developer",
    company: "Uber",
    description: "Build responsive web applications. React, TypeScript required. English team.",
    url: "https://uber.careers",
    languages: "English",
    badge: "🟢",
    matchScore: null
  },
  {
    title: "Marketing Executive",
    company: "L'Oréal",
    description: "Lead digital marketing campaigns. English and Mandarin preferred.",
    url: "https://loreal.com/careers",
    languages: "English, Mandarin",
    badge: "🟢",
    matchScore: null
  },
  {
    title: "Operations Manager",
    company: "Deliveroo",
    description: "Manage logistics and rider operations. English required.",
    url: "https://deliveroo.hk/careers",
    languages: "English",
    badge: "🟢",
    matchScore: null
  },
  {
    title: "Product Manager",
    company: "Airbnb",
    description: "Drive product strategy for APAC market. English speaking team.",
    url: "https://airbnb.com/careers",
    languages: "English",
    badge: "🟢",
    matchScore: null
  },
  {
    title: "Financial Analyst",
    company: "J.P. Morgan",
    description: "Support investment banking operations. Strong Excel and finance knowledge.",
    url: "https://jpmorgan.com/careers",
    languages: "English",
    badge: "🟢",
    matchScore: null
  },
  {
    title: "UX/UI Designer",
    company: "Canva",
    description: "Design user interfaces for global products. Figma and portfolio required.",
    url: "https://canva.com/careers",
    languages: "English",
    badge: "🟢",
    matchScore: null
  },
  {
    title: "Research Assistant",
    company: "HKUST",
    description: "Support academic research in computer science. English environment.",
    url: "https://hkust.hk/careers",
    languages: "English",
    badge: "🟢",
    matchScore: null
  },
  {
    title: "Business Development",
    company: "Shopify",
    description: "Acquire merchants for e-commerce platform. English required.",
    url: "https://shopify.com/careers",
    languages: "English",
    badge: "🟢",
    matchScore: null
  },
  {
    title: "IT Support Specialist",
    company: "Apple",
    description: "Provide technical support for Apple products. English speaking.",
    url: "https://apple.com/careers",
    languages: "English",
    badge: "🟢",
    matchScore: null
  },
  {
    title: "Graphic Designer",
    company: "Nike",
    description: "Create visual content for APAC campaigns. Adobe Creative Suite required.",
    url: "https://nike.com/careers",
    languages: "English",
    badge: "🟢",
    matchScore: null
  },
  {
    title: "Project Coordinator",
    company: "KPMG",
    description: "Coordinate audit and consulting projects. English workplace.",
    url: "https://kpmg.com/careers",
    languages: "English",
    badge: "🟢",
    matchScore: null
  },
  {
    title: "Cloud Engineer",
    company: "Amazon Web Services",
    description: "Deploy and manage cloud infrastructure. AWS certification valued.",
    url: "https://aws.amazon.com/careers",
    languages: "English",
    badge: "🟢",
    matchScore: null
  },
  {
    title: "Content Writer",
    company: "Time Out Hong Kong",
    description: "Write English content about HK events and restaurants.",
    url: "https://timeout.com/careers",
    languages: "English",
    badge: "🟢",
    matchScore: null
  },
  {
    title: "Sales Associate",
    company: "Tiffany & Co.",
    description: "Luxury retail sales. English and Mandarin required.",
    url: "https://tiffany.com/careers",
    languages: "English, Mandarin",
    badge: "🟢",
    matchScore: null
  },
  {
    title: "Legal Assistant",
    company: "Clifford Chance",
    description: "Support international law firm. English legal writing skills needed.",
    url: "https://cliffordchance.com/careers",
    languages: "English",
    badge: "🟢",
    matchScore: null
  },
  {
    title: "Social Media Manager",
    company: "Meta",
    description: "Manage social channels for APAC. English content creation.",
    url: "https://meta.com/careers",
    languages: "English",
    badge: "🟢",
    matchScore: null
  },
  {
    title: "Cybersecurity Analyst",
    company: "PwC",
    description: "Security audits and risk assessment. English reports.",
    url: "https://pwc.com/careers",
    languages: "English",
    badge: "🟢",
    matchScore: null
  },
  {
    title: "Event Coordinator",
    company: "Hong Kong Convention Centre",
    description: "Plan international conferences. English communication required.",
    url: "https://hkcec.com/careers",
    languages: "English",
    badge: "🟢",
    matchScore: null
  },
  {
    title: "Investment Analyst",
    company: "BlackRock",
    description: "Research global markets. English fluency required.",
    url: "https://blackrock.com/careers",
    languages: "English",
    badge: "🟢",
    matchScore: null
  },
  {
    title: "English Teacher",
    company: "EF Education First",
    description: "Teach English to Hong Kong students. Native English speaker.",
    url: "https://ef.com/careers",
    languages: "English",
    badge: "🟢",
    matchScore: null
  },
  {
    title: "Logistics Coordinator",
    company: "DHL",
    description: "Manage international shipping. English required.",
    url: "https://dhl.com/careers",
    languages: "English",
    badge: "🟢",
    matchScore: null
  },
  {
    title: "HR Recruiter",
    company: "Michael Page",
    description: "Recruit for MNCs in Hong Kong. English interviewing skills.",
    url: "https://michaelpage.com/careers",
    languages: "English",
    badge: "🟢",
    matchScore: null
  },
  {
    title: "Game Developer",
    company: "Ubisoft",
    description: "Develop mobile games. C# and Unity required. English team.",
    url: "https://ubisoft.com/careers",
    languages: "English",
    badge: "🟢",
    matchScore: null
  },
  {
    title: "Public Relations Officer",
    company: "Burberry",
    description: "Manage brand communications. English writing skills.",
    url: "https://burberry.com/careers",
    languages: "English",
    badge: "🟢",
    matchScore: null
  },
  {
    title: "Database Administrator",
    company: "Oracle",
    description: "Manage SQL databases. English documentation.",
    url: "https://oracle.com/careers",
    languages: "English",
    badge: "🟢",
    matchScore: null
  },
  {
    title: "Hotel Receptionist",
    company: "Four Seasons Hotel",
    description: "Welcome international guests. English and Mandarin preferred.",
    url: "https://fourseasons.com/careers",
    languages: "English, Mandarin",
    badge: "🟢",
    matchScore: null
  },
  {
    title: "Supply Chain Analyst",
    company: "Maersk",
    description: "Optimize shipping routes. English required.",
    url: "https://maersk.com/careers",
    languages: "English",
    badge: "🟢",
    matchScore: null
  },
  {
    title: "SEO Specialist",
    company: "Semrush",
    description: "Improve search rankings for HK market. English content.",
    url: "https://semrush.com/careers",
    languages: "English",
    badge: "🟢",
    matchScore: null
  },

  // ========== CHINESE/CANTONESE REQUIRED JOBS (NO BADGE) ==========
  {
    title: "Customer Service Officer",
    company: "Bank of China",
    description: "Handle customer inquiries in Cantonese and English.",
    url: "https://boc.cn/careers",
    languages: "Cantonese, English",
    badge: "",
    matchScore: null
  },
  {
    title: "Administrative Assistant",
    company: "Sun Hung Kai Properties",
    description: "Support daily office operations. Cantonese required.",
    url: "https://shkp.com/careers",
    languages: "Cantonese, English",
    badge: "",
    matchScore: null
  },
  {
    title: "Sales Representative",
    company: "PCCW",
    description: "Sell telecom products. Fluent Cantonese needed.",
    url: "https://pccw.com/careers",
    languages: "Cantonese",
    badge: "",
    matchScore: null
  },
  {
    title: "Kindergarten Teacher",
    company: "Victoria Kindergarten",
    description: "Teach children in Cantonese and basic English.",
    url: "https://victoria.edu.hk/careers",
    languages: "Cantonese",
    badge: "",
    matchScore: null
  },
  {
    title: "Accounting Clerk",
    company: "Hang Seng Bank",
    description: "Process invoices and receipts. Cantonese and Chinese reading required.",
    url: "https://hangseng.com/careers",
    languages: "Cantonese, Chinese",
    badge: "",
    matchScore: null
  },
  {
    title: "Retail Store Manager",
    company: "Sa Sa Cosmetics",
    description: "Manage local store. Cantonese essential.",
    url: "https://sasa.com/careers",
    languages: "Cantonese",
    badge: "",
    matchScore: null
  },
  {
    title: "Social Worker",
    company: "HK Society for the Blind",
    description: "Serve local community. Cantonese and Chinese writing required.",
    url: "https://hksb.org.hk/careers",
    languages: "Cantonese, Chinese",
    badge: "",
    matchScore: null
  },
  {
    title: "Marketing Assistant",
    company: "TVB",
    description: "Create Chinese content for local TV. Cantonese required.",
    url: "https://tvb.com/careers",
    languages: "Cantonese, Chinese",
    badge: "",
    matchScore: null
  },
  {
    title: "Clinic Assistant",
    company: "Quality HealthCare",
    description: "Assist doctors with local patients. Cantonese needed.",
    url: "https://qhe.com.hk/careers",
    languages: "Cantonese",
    badge: "",
    matchScore: null
  },
  {
    title: "Property Agent",
    company: "Midland Realty",
    description: "Sell properties to local Hong Kongers. Fluent Cantonese.",
    url: "https://midland.com.hk/careers",
    languages: "Cantonese",
    badge: "",
    matchScore: null
  },
  {
    title: "Insurance Agent",
    company: "AIA Hong Kong",
    description: "Sell insurance to local clients. Cantonese required.",
    url: "https://aia.com.hk/careers",
    languages: "Cantonese",
    badge: "",
    matchScore: null
  },
  {
    title: "Restaurant Manager",
    company: "Café de Coral",
    description: "Manage local HK restaurant. Cantonese essential.",
    url: "https://cafedecoral.com/careers",
    languages: "Cantonese",
    badge: "",
    matchScore: null
  },
  {
    title: "Nurse",
    company: "Prince of Wales Hospital",
    description: "Patient care. Cantonese and Chinese medical terms required.",
    url: "https://ha.org.hk/careers",
    languages: "Cantonese, Chinese",
    badge: "",
    matchScore: null
  },
  {
    title: "Bank Teller",
    company: "Standard Chartered",
    description: "Handle local customer transactions. Cantonese needed.",
    url: "https://sc.com/careers",
    languages: "Cantonese, English",
    badge: "",
    matchScore: null
  },
  {
    title: "Receptionist",
    company: "Chinese Medical Clinic",
    description: "Greet local patients. Cantonese required.",
    url: "https://cmc.com.hk/careers",
    languages: "Cantonese",
    badge: "",
    matchScore: null
  },
  {
    title: "Logistics Clerk",
    company: "SF Express",
    description: "Process local deliveries. Cantonese and Chinese forms.",
    url: "https://sf-express.com/careers",
    languages: "Cantonese, Chinese",
    badge: "",
    matchScore: null
  },
  {
    title: "Beauty Consultant",
    company: "Watsons",
    description: "Advise local customers on products. Cantonese required.",
    url: "https://watsons.com.hk/careers",
    languages: "Cantonese",
    badge: "",
    matchScore: null
  },
  {
    title: "Construction Site Supervisor",
    company: "Gammon Construction",
    description: "Oversee local construction. Cantonese and safety regulations.",
    url: "https://gammon.com/careers",
    languages: "Cantonese",
    badge: "",
    matchScore: null
  },
  {
    title: "Legal Secretary",
    company: "Local Law Firm",
    description: "Chinese legal documents. Cantonese and written Chinese required.",
    url: "https://example.com/careers",
    languages: "Cantonese, Chinese",
    badge: "",
    matchScore: null
  },
  {
    title: "Flight Attendant",
    company: "Cathay Pacific",
    description: "Serve passengers on HK flights. Cantonese and English required.",
    url: "https://cathaypacific.com/careers",
    languages: "Cantonese, English",
    badge: "",
    matchScore: null
  }
];

// Export for use in HTML
if (typeof module !== 'undefined' && module.exports) {
  module.exports = jobs;
}
