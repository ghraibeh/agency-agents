# Workflow: Employee Wiki Assistant

> How to use the Employee Wiki Assistant to answer common employee questions, from onboarding queries to IT troubleshooting, with real-time retrieval from your OpenRAG knowledge base.

## Prerequisites

1. OpenRAG running and accessible (see [integrations/openrag-integration.md](../integrations/openrag-integration.md))
2. Company documents indexed in OpenRAG (HR handbook, IT guides, policies)
3. `OPENRAG_BASE_URL` and `OPENRAG_API_KEY` set in your environment
4. Employee Wiki Assistant installed: `cp support/support-employee-wiki-assistant.md ~/.claude/agents/`

---

## The Scenario

Alex just joined the company as a software engineer. It's their first week. They have questions about their benefits, how to set up their laptop, what the vacation policy is, and who to contact for various things. Instead of scheduling time with HR or waiting for IT to respond to a ticket, Alex asks the Employee Wiki Assistant.

---

## Step-by-Step Conversations

### Day 1: Onboarding Setup

**Alex:**
```
Activate Employee Wiki Assistant.

I'm a new employee starting today. What do I need to set up on my first day?
```

**Employee Wiki Assistant:**
```
## Answer

Welcome! Here are the key tasks for your first day:

1. **Complete your HR paperwork** — Log into the HR portal (link in your welcome email) and submit your tax forms, emergency contact, and direct deposit details. Deadline: end of day 1.
2. **Set up your laptop** — Follow the IT Onboarding Guide: install the VPN client, enable full-disk encryption, and connect to the corporate Wi-Fi using your employee credentials.
3. **Request system access** — Submit an IT access request form for the tools your manager listed in your onboarding plan. Standard turnaround is 24 hours.
4. **Complete mandatory training** — The Security Awareness and Data Privacy training modules must be completed within your first 5 business days. Access them via the Learning Management System.
5. **Review the Employee Handbook** — Sections 2 (Code of Conduct) and 5 (Benefits Overview) are the most relevant for day one.

## Sources
- **IT Onboarding Guide v3.2** — "Day 1 Laptop Setup" section, pp. 4–7
- **New Employee Checklist 2025** — "First Day Tasks" checklist, item 1–5
- **Employee Handbook** — Section 2.1 (Code of Conduct) and Section 5 (Benefits)

---
*Questions about your specific access needs? Contact IT Helpdesk at helpdesk@company.com or Slack #it-support.*
```

---

### Day 3: Vacation Policy

**Alex:**
```
How many vacation days do I get as a new employee, and when can I start using them?
```

**Employee Wiki Assistant:**
```
## Answer

As a new full-time employee, you receive **15 days of paid vacation per year**, accrued monthly at 1.25 days per month starting from your hire date.

**When you can use them**: Vacation days are available as they accrue. There is no waiting period, but you must have a positive accrual balance before taking time off. Your first accrual posts at the end of your first full calendar month.

**How to request time off**: Submit a vacation request in the HR portal at least 5 business days in advance for absences of 3 days or fewer, and at least 2 weeks in advance for longer periods. Your manager approves all requests.

**Rollover**: Up to 5 unused vacation days roll over to the following year. Days above the 5-day rollover cap are forfeited on December 31.

## Sources
- **Employee Handbook** — Section 7.2 "Paid Time Off — Vacation", pp. 34–35
- **HR Policy PTO-001** — "Accrual Schedule and Usage Rules", effective January 2025

---
*For questions about your specific balance, contact HR at hr@company.com.*
```

---

### Day 5: IT Security Question

**Alex:**
```
I received an email asking me to click a link and verify my credentials. Is this a phishing attempt?
```

**Employee Wiki Assistant:**
```
## Answer

Treat this with caution. The company will **never ask you to verify your credentials via an unsolicited email link**. This is a common phishing pattern.

**What to do right now:**

1. **Do not click the link.**
2. **Report it immediately** — Forward the email as an attachment to security@company.com and notify IT via Slack #security-incidents.
3. **If you already clicked the link**, report it immediately to IT Security regardless — they can check for compromise and help you reset credentials before any damage spreads.

The IT Security team responds to phishing reports within 2 hours during business hours.

## Sources
- **IT Security Policy SEC-003** — "Phishing and Social Engineering", Section 4.1
- **Incident Reporting Procedure** — "How to Report a Security Incident", Step 1–3

---
*Urgent security issue? Call the IT Security hotline: +1-800-XXX-XXXX (listed in your employee handbook inside front cover).*
```

---

### Week 2: Benefits Enrollment

**Alex:**
```
What are my options for health insurance and when is the enrollment deadline?
```

**Employee Wiki Assistant:**
```
## Answer

You have three health insurance plan options:

| Plan | Type | Monthly Premium (Employee) | Deductible |
|------|------|---------------------------|------------|
| Plan A — Essential | HMO | $85 | $1,500 |
| Plan B — Standard | PPO | $145 | $750 |
| Plan C — Premium | PPO | $210 | $250 |

The company covers 70% of the premium for all plans. Dependents can be added at an additional cost listed in the Benefits Guide.

**Enrollment deadline**: You must enroll within **30 days of your hire date**. Missing this window means you must wait until the next open enrollment period (each November) unless you have a qualifying life event.

**How to enroll**: Log into the Benefits Portal (link on the HR intranet homepage), select your plan, and add any dependents. Confirmation is sent to your work email within 24 hours.

## Sources
- **2025 Benefits Guide** — "Health Insurance Options", pp. 8–12
- **Benefits Enrollment Policy** — "New Employee Enrollment Window", Section 2.3

---
*For personalized plan comparison or dependent enrollment questions, schedule a 15-minute call with HR Benefits: hr-benefits@company.com.*
```

---

## When the Knowledge Base Doesn't Have the Answer

If Alex asks something the indexed documents don't cover:

**Alex:**
```
What is the process for getting approval to attend an external conference?
```

**Employee Wiki Assistant (when document not found):**
```
## Answer

I was not able to find a documented conference approval process in the current knowledge base.

Based on common company practices, conference attendance typically requires manager approval and may involve a budget request — but I cannot confirm the specific process your company uses without a source document.

## Sources
*No relevant documents found for this question.*

---
*Please contact your manager directly or reach out to Finance/HR to get the correct process. This question has been flagged for the knowledge base administrator — the relevant policy document should be added soon.*
```

---

## With Memory (Optional)

If you have an MCP memory server configured, the agent can maintain context across Alex's onboarding sessions:

```
Activate Employee Wiki Assistant.

Project: Alex-Onboarding. Recall any previous context for this employee's onboarding questions and continue from where we left off.
```

At the end of each session, the agent stores a summary tagged with `employee-wiki`, `onboarding`, and `alex-onboarding` so future sessions can pick up without repeating answers already given.

See [integrations/mcp-memory/README.md](../integrations/mcp-memory/README.md) for memory server setup.

---

## Tips

- **Be specific about the domain**: "What is the IT policy for personal device use?" gets better results than "Can I use my phone at work?"
- **Mention your role or team** when relevant: "As an engineer, what tools do I need to request access to?" allows the agent to retrieve role-specific onboarding guides
- **Ask follow-up questions**: The agent tracks conversation context, so "What about for contractors?" after a policy answer will retrieve the contractor-specific variant
- **Flag outdated answers**: If a retrieved answer conflicts with something your manager told you, report it so the source document can be updated

---

## Related

- [Employee Wiki Assistant agent](../support/support-employee-wiki-assistant.md)
- [OpenRAG integration guide](../integrations/openrag-integration.md)
