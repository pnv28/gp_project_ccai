from pathlib import Path
import json
rows = [
    "Google|Digital Marketing Intern|Support campaign analytics and English content creation for APAC launches.|https://careers.google.com/jobs/results/|English",
    "HSBC|Customer Success Associate|Manage international client onboarding and English financial support.|https://www.hsbc.com/careers/|English,Cantonese",
    "Uber|Product Analyst|Analyze rider and driver metrics for Hong Kong mobility products.|https://www.uber.com/global/en/careers/|English",
    "Deliveroo|Operations Coordinator|Coordinate restaurant partnerships and support delivery operations.|https://careers.deliveroo.com/|English,Chinese",
    "L'Oréal|Brand Assistant|Help execute English marketing plans for luxury beauty brands.|https://careers.loreal.com/|English",
    "Bank of China|Risk Analyst|Support risk assessments with local language teams.|https://www.boc.cn/en/careers/|Chinese,English",
    "Amazon|Communications Intern|Draft English internal communications for customer teams.|https://www.amazon.jobs/|English",
    "Standard Chartered|Junior Analyst|Prepare reports for international credit teams.|https://www.sc.com/en/careers/|English",
    "Apple|Sales Assistant|Provide English-language product guidance to global customers.|https://www.apple.com/careers/|English",
    "Cathay Pacific|Event Assistant|Support international event logistics and guest services.|https://careers.cathaypacific.com/|English,Cantonese",
    "Deloitte|Accounting Assistant|Support audit preparation for multinational clients.|https://www2.deloitte.com/global/en/careers.html|English",
    "JPMorgan|HR Assistant|Help recruit talent for APAC teams.|https://www.jpmorganchase.com/careers|English",
    "Netflix|Customer Support Agent|Provide English support for streaming subscribers.|https://jobs.netflix.com/|English",
    "TikTok|Social Media Coordinator|Create English content for regional campaigns.|https://careers.tiktok.com/|English",
    "Sony|QA Tester|Test products and document defects in English.|https://www.sony.com/en/SonyInfo/Careers/|English",
    "FedEx|Logistics Assistant|Support international freight tracking and customer updates.|https://careers.fedex.com/|English",
    "P&G|Procurement Assistant|Support procurement tasks for regional suppliers.|https://www.pgcareers.com/|English",
    "PwC|Finance Intern|Assist with financial modelling and audit documentation.|https://www.pwc.com/careers.html|English",
    "Meta|Marketing Analyst|Analyze campaign performance for English-speaking advertisers.|https://www.metacareers.com/|English",
    "Citi|Office Administrator|Provide admin support to finance teams.|https://www.citigroup.com/citi/careers/|English",
    "Unilever|Supply Chain Trainee|Track inventory and support sourcing teams.|https://www.unilever.com/careers/|English",
    "Trip.com|Content Writer|Write English travel guides for Hong Kong.|https://careers.trip.com/|English",
    "Marriott|Hospitality Coordinator|Coordinate guest services for international visitors.|https://www.marriott.com/careers/|English",
    "Microsoft|Data Analyst Intern|Build reports for enterprise products in English.|https://careers.microsoft.com/|English",
    "SAP|Systems Support Intern|Assist English IT teams with documentation and testing.|https://jobs.sap.com/|English",
    "Visa|Account Executive|Support English client relationships for payment products.|https://www.visa.com/careers/|English",
    "Goldman Sachs|Corporate Services Intern|Support English finance teams with logistics.|https://www.goldmansachs.com/careers/|English",
    "EY|Training Coordinator|Organize English training sessions for graduates.|https://www.ey.com/en_gl/careers|English",
    "Hermès|Digital Designer|Support English branding and visual campaigns.|https://www.hermes.com/ww/en/careers/|English",
    "Nestlé|Sustainability Intern|Help develop English sustainability reports.|https://www.nestle.com/jobs|English",
    "EF Education First|Learning Support Assistant|Help deliver English study programs.|https://careers.ef.com/|English",
    "McKinsey|Market Research Intern|Collect English insights for consulting teams.|https://www.mckinsey.com/careers|English",
    "Mastercard|Compliance Assistant|Review English compliance for payment products.|https://www.mastercard.com/careers/|English",
    "Hermès|Public Relations Intern|Support English media relations for luxury events.|https://www.hermes.com/ww/en/careers/|English",
    "Samsung|Sales Trainee|Assist product demos and customer service in retail.|https://www.samsung.com/hk/careers/|English,Chinese",
    "Zalora|E-commerce Assistant|Manage product listings and customer questions.|https://www.zalora.com/careers/|English,Chinese",
    "Zara|Retail Supervisor|Manage floor operations and customer service.|https://www.zara.com/ww/en/jobs|English,Chinese",
    "Uniqlo|Store Assistant|Assist customers and manage retail stock.|https://www.uniqlo.com/hk/en/careers/|Chinese",
    "Häagen-Dazs|Restaurant Host|Welcome guests at an English-friendly dessert restaurant.|https://www.haagendazs.com.hk/careers|Chinese,English",
    "MTR Corporation|Data Entry Clerk|Maintain transit operations records.|https://careers.mtr.com/|Chinese",
    "Amazon|Warehouse Support|Help process orders and logistics in distribution centers.|https://www.amazon.jobs/|Chinese",
    "Swire Coca-Cola|Retail Merchandiser|Support promotions for local beverage partners.|https://www.swirecc.com/en/careers/|Chinese",
    "McDonald’s|Kitchen Supervisor|Oversee restaurant operations and kitchen teams.|https://careers.mcdonalds.com/|Chinese",
    "Bank of China|HR Intern|Assist recruitment operations with local coordination.|https://www.boc.cn/en/careers/|Chinese",
    "Swire Properties|Sales Coordinator|Coordinate leasing support with local clients.|https://www.swireproperties.com/en/careers|English,Chinese",
    "Asia Connect Events|Event Planning Assistant|Help plan international conferences for students.|https://www.asiaconnectevents.com/careers|English,Chinese",
    "City Center Apparel|Retail Sales Associate|Manage fashion retail operations and customer service.|https://www.citycenterapparel.com/careers|Chinese,English",
    "Harrods|Merchandise Assistant|Manage high-end retail inventory and customer service.|https://www.harrods.com/en-hk/careers|English",
    "Bank of China|Customer Liaison|Assist Cantonese-speaking banking clients.|https://www.boc.cn/en/careers/|Chinese",
    "Global EdTech Hub|Customer Success Intern|Support English onboarding for international education clients.|https://www.globaledtechhub.com/careers|English",
    "Youth Support NGO|Community Outreach Associate|Support English outreach programs for students.|https://www.youthsupportngo.com/jobs|English",
]
assert len(rows) == 50
jobs = []
for idx, row in enumerate(rows):
    parts = row.split("|")
    if len(parts) != 5:
        raise ValueError(f"bad row {idx}: {parts}")
    company, title, description, url, languages = parts
    jobs.append({
        "title": title,
        "company": company,
        "description": description,
        "url": url,
        "languages": [lang.strip() for lang in languages.split(",")],
        "badge": "🟢" if idx < 30 else "",
        "matchScore": 90 - (idx % 10) * 2,
    })
assert len(jobs) == 50
assert sum(1 for job in jobs if job["badge"] == "🟢") == 30
assert sum(1 for job in jobs if job["badge"] == "") == 20
Path("jobs.js").write_text("const jobData = " + json.dumps(jobs, ensure_ascii=False, indent=2) + ";\n", encoding="utf-8")
print("wrote", len(jobs))
