/**
 * Name-based gender estimation.
 *
 * Uses a curated list of common first names mapped to gender probability.
 * This is a heuristic — not definitive — used for engagement pattern analysis.
 * Covers South Asian, Western, Arabic, East Asian, African, and Latin names.
 */

/* exported GenderEstimator */
const GenderEstimator = (() => {
  "use strict";

  // Female-leaning names (common globally)
  const F = new Set([
    // South Asian
    "akancha","aisha","aarti","aditi","aishwarya","amita","ananya","anju","ankita",
    "anushka","arpita","bhavna","chitra","deepa","deepika","devi","divya","durga",
    "ekta","garima","gauri","hema","isha","jaya","jyoti","kajal","kamala","kavita",
    "kavya","kiran","komal","lata","lavanya","laxmi","madhu","mamta","manisha",
    "meena","megha","meghna","mira","monika","mona","namita","nandini","neelam",
    "neetu","neha","nidhi","nikita","nisha","nithya","padma","pallavi","parvati",
    "pinki","pooja","poonam","pragya","pratibha","preeti","priya","priyanka",
    "puja","radha","rani","rashmi","rekha","renuka","renu","richa","ritu","riya",
    "rohini","ruby","rupa","rupali","sadhana","sakshi","sandhya","sangita","sarita",
    "savita","seema","shanti","shikha","shilpa","shruti","simran","sita","smita",
    "sneha","sonia","sonu","sudha","sugandha","sujata","sunita","suparna","sushmita",
    "swati","tanuja","tara","tripti","tulsi","uma","urmila","usha","vaishali",
    "vandana","varsha","vidya","vinita","yamini","yasmin",
    // Western
    "abigail","alice","amanda","amber","amy","andrea","angela","anna","annie",
    "ashley","barbara","betty","brenda","brittany","carol","caroline","catherine",
    "charlotte","cheryl","christina","christine","cindy","claire","crystal","cynthia",
    "daisy","dana","danielle","deborah","denise","diana","diane","donna","dorothy",
    "elizabeth","ella","ellen","emily","emma","erica","eva","evelyn","faith",
    "fiona","florence","frances","gabriella","grace","haley","hannah","heather",
    "helen","holly","irene","isabella","jacqueline","jane","janet","janice",
    "jasmine","jennifer","jessica","jill","joan","joanne","julia","julie","karen",
    "kate","katherine","kathleen","kathryn","katie","kelly","kimberly","kristen",
    "kristin","laura","lauren","leslie","lily","linda","lisa","lori","louise",
    "lucy","lynn","madison","margaret","maria","marie","marilyn","martha","mary",
    "megan","melissa","michelle","miranda","molly","monica","nancy","natalie",
    "natasha","nicole","olivia","pamela","patricia","paula","rachel","rebecca",
    "rita","robin","rosa","rose","ruth","samantha","sandra","sara","sarah",
    "sharon","shirley","sophia","sophie","stacy","stephanie","susan","tammy",
    "tanya","teresa","theresa","tiffany","tracy","valerie","vanessa","veronica",
    "victoria","virginia","vivian","wendy","whitney",
    // Arabic
    "amina","asmaa","fatima","huda","layla","leila","mariam","maryam","noor",
    "nour","rania","salma","sara","yara","yasmine","zahra","zainab",
    // East Asian
    "ai","akiko","chen","fang","haruka","hina","hua","jing","li","lin",
    "mei","ming","misaki","sakura","xia","xiao","yan","yui","yuki",
    // African
    "abena","adaeze","amara","chidinma","chiamaka","ebele","ngozi","nneka","obioma",
  ]);

  // Male-leaning names (common globally)
  const M = new Set([
    // South Asian
    "aarav","abhishek","ajay","akash","amar","amit","amitabh","anand","anil",
    "anjum","ankit","arjun","arun","ashish","ashok","atul","bhaskar","bharat",
    "chandan","deepak","devam","dheeraj","dinesh","ganesh","gaurav","govind",
    "hari","harsh","hemant","hitesh","jatin","jayesh","karan","kartik","kishore",
    "krishna","kumar","lalit","mahesh","manoj","manish","mohan","mohit","mukesh",
    "naman","naresh","narendra","naveen","nikhil","nitin","pankaj","pavan",
    "pradeep","prakash","pranav","prasad","rahul","raj","rajesh","rajiv","rakesh",
    "ram","ramesh","ravi","rohit","sachin","sahil","sandeep","sanjay","santosh",
    "satish","shailesh","shankar","shiv","shivam","siddharth","sonu","sudhir",
    "sumit","sunil","suresh","tushar","varun","vijay","vikram","vinay","vinod",
    "vipin","vishal","vivek","yogesh",
    // Western
    "aaron","adam","adrian","alan","albert","alex","alexander","andrew","anthony",
    "arthur","austin","benjamin","bill","billy","blake","brad","brandon","brian",
    "bruce","bryan","caleb","carl","carlos","chad","charles","chris","christian",
    "christopher","colin","connor","craig","dale","daniel","danny","david","dean",
    "dennis","derek","dominic","donald","douglas","drew","dustin","dylan","earl",
    "eddie","edward","eric","ethan","eugene","evan","frank","fred","gary","george",
    "gerald","glen","gordon","grant","greg","gregory","harry","henry","howard",
    "hunter","ian","jack","jacob","jake","james","jason","jeff","jeffrey","jeremy",
    "jerry","jesse","jim","jimmy","joe","joel","john","johnny","jon","jonathan",
    "jordan","jose","joseph","joshua","juan","justin","keith","kenneth","kevin",
    "kyle","lance","larry","lawrence","leo","leon","logan","louis","lucas","luke",
    "mark","martin","mason","matt","matthew","max","michael","mike","mitchell",
    "nathan","nicholas","nick","noah","oliver","oscar","owen","patrick","paul",
    "peter","philip","ralph","randy","raymond","richard","rick","robert","roger",
    "ronald","ross","russell","ryan","samuel","scott","sean","seth","shane",
    "shaun","simon","spencer","stanley","stephen","steve","steven","stuart",
    "ted","terry","thomas","tim","timothy","todd","tom","tony","travis","trevor",
    "troy","tyler","victor","vincent","wade","walter","warren","wayne","william",
    // Arabic
    "ahmed","ali","amir","faisal","hamza","hassan","hussein","ibrahim","khalid",
    "mahmoud","mohammed","mohammad","muhammad","mustafa","omar","rashid","tariq",
    "youssef","zaid",
    // East Asian
    "chen","dae","feng","hiro","hiroshi","jian","jun","kenji","lei","liang",
    "min","ryu","shin","tao","wei","wen","yong","yu",
    // African
    "chidi","emeka","kwame","obinna","oluwaseun","oluwa","tunde","uche",
  ]);

  /**
   * Estimate gender from a full name.
   * Returns "female", "male", or "unknown".
   */
  function estimate(fullName) {
    if (!fullName) return "unknown";
    const first = fullName.trim().split(/\s+/)[0].toLowerCase()
      .replace(/[^a-z]/g, "");
    if (!first) return "unknown";
    if (F.has(first)) return "female";
    if (M.has(first)) return "male";
    // Try prefix matching for variations (e.g., "priyanka" → "priya")
    for (const name of F) {
      if (first.startsWith(name) && first.length <= name.length + 3) return "female";
    }
    for (const name of M) {
      if (first.startsWith(name) && first.length <= name.length + 3) return "male";
    }
    return "unknown";
  }

  /**
   * Estimate gender ratio from an array of names.
   * Returns { female, male, unknown, total, femalePct, malePct }
   */
  function analyzeNames(names) {
    let female = 0, male = 0, unknown = 0;
    for (const name of names) {
      const g = estimate(name);
      if (g === "female") female++;
      else if (g === "male") male++;
      else unknown++;
    }
    const known = female + male;
    return {
      female, male, unknown,
      total: names.length,
      femalePct: known > 0 ? female / known : null,
      malePct: known > 0 ? male / known : null,
    };
  }

  return { estimate, analyzeNames };
})();
