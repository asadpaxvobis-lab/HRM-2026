import type { LetterType } from '@/lib/letters'

export type DefaultLetterTemplate = {
  code: string
  name: string
  letter_type: LetterType
  description: string
  subject: string
  body: string
}

export const DEFAULT_LETTER_TEMPLATES: DefaultLetterTemplate[] = [
  {
    code: 'TPL-0001',
    name: 'Standard offer letter',
    letter_type: 'OFFER',
    description: 'Offer of employment before joining',
    subject: 'Offer of Employment — {{employee_name}}',
    body: `{{company_name}}
{{company_address}}

Date: {{date_today}}

To,
{{employee_name}}
CNIC: {{cnic}}
{{email}}

Subject: Offer of Employment

Dear {{first_name}},

We are pleased to offer you the position of {{designation}} in the {{department}} department at our {{branch}} location, subject to satisfactory verification of your documents and medical fitness (if applicable).

Proposed terms:
• Designation: {{designation}}
• Department: {{department}}
• Branch: {{branch}}
• Date of joining: {{date_of_joining}}
• Gross monthly salary: PKR {{salary_gross}} (Basic PKR {{salary_basic}} plus applicable allowances)

This offer is contingent upon company policies, attendance rules, and any statutory requirements. Please confirm acceptance in writing.

Yours sincerely,

_________________________
Authorized Signatory
{{company_name}}`,
  },
  {
    code: 'TPL-0002',
    name: 'Appointment letter',
    letter_type: 'APPOINTMENT',
    description: 'Formal appointment after joining',
    subject: 'Appointment Letter — {{employee_name}}',
    body: `{{company_name}}
{{company_address}}

Date: {{date_today}}

To,
{{employee_name}} ({{employee_code}})
{{designation}} — {{department}}
{{branch}}

Dear {{first_name}},

Further to your acceptance of our offer, we are pleased to confirm your appointment as {{designation}} in {{department}} at {{branch}}, effective {{date_of_joining}}.

Your employment is subject to the rules, regulations, and policies of {{company_name}} as amended from time to time. Your compensation package will be as communicated at the time of offer (current gross: PKR {{salary_gross}} per month).

We welcome you to the team and wish you a successful career with us.

Yours sincerely,

_________________________
Authorized Signatory
{{company_name}}`,
  },
  {
    code: 'TPL-0003',
    name: 'Confirmation after probation',
    letter_type: 'CONFIRMATION',
    description: 'Confirm employment after probation period',
    subject: 'Confirmation of Employment — {{employee_name}}',
    body: `{{company_name}}
{{company_address}}

Date: {{date_today}}

To,
{{employee_name}} ({{employee_code}})
{{designation}}, {{department}}

Dear {{first_name}},

We are pleased to inform you that your probation has been completed satisfactorily. Your employment with {{company_name}} is hereby confirmed with effect from {{date_today}}.

Your designation, department, and place of posting remain {{designation}} / {{department}} at {{branch}}. All other terms and conditions of your appointment continue unchanged.

Congratulations on your confirmation.

Yours sincerely,

_________________________
Authorized Signatory
{{company_name}}`,
  },
  {
    code: 'TPL-0004',
    name: 'Promotion letter',
    letter_type: 'PROMOTION',
    description: 'Promotion to a new designation',
    subject: 'Promotion — {{employee_name}}',
    body: `{{company_name}}
{{company_address}}

Date: {{date_today}}

To,
{{employee_name}} ({{employee_code}})
{{department}} — {{branch}}

Dear {{first_name}},

We are pleased to announce your promotion to {{designation}}, effective {{date_today}}.

This decision reflects your performance, conduct, and contribution to {{company_name}}. Your revised compensation (if any) will be communicated separately through payroll / HR.

Please report to your line manager for handover of revised responsibilities.

Yours sincerely,

_________________________
Authorized Signatory
{{company_name}}`,
  },
  {
    code: 'TPL-0005',
    name: 'Experience certificate',
    letter_type: 'EXPERIENCE',
    description: 'Certificate of employment / experience',
    subject: 'Experience Certificate — {{employee_name}}',
    body: `{{company_name}}
{{company_address}}

Date: {{date_today}}

TO WHOM IT MAY CONCERN

Experience Certificate

This is to certify that {{employee_name}} (CNIC: {{cnic}}, Employee ID: {{employee_code}}) was employed with {{company_name}} as {{designation}} in the {{department}} department at {{branch}}.

Date of joining: {{date_of_joining}}
Employment status: As per company records at the date of this certificate.

During employment, {{first_name}} performed duties to the best of our knowledge and left on good terms (or as per separation record on file).

This certificate is issued at the request of the employee for {{purpose}}.

For {{company_name}}

_________________________
Authorized Signatory`,
  },
  {
    code: 'TPL-0006',
    name: 'Salary certificate',
    letter_type: 'SALARY_CERTIFICATE',
    description: 'Proof of monthly salary for banks / embassies',
    subject: 'Salary Certificate — {{employee_name}}',
    body: `{{company_name}}
{{company_address}}

Date: {{date_today}}

TO WHOM IT MAY CONCERN

Salary Certificate

This is to certify that {{employee_name}} (CNIC: {{cnic}}, Employee ID: {{employee_code}}) is a permanent employee of {{company_name}}, working as {{designation}} in {{department}} at {{branch}} since {{date_of_joining}}.

Monthly salary breakdown (PKR):
• Basic salary: {{salary_basic}}
• House rent: {{salary_house_rent}}
• Medical: {{salary_medical}}
• Conveyance: {{salary_conveyance}}
• Utilities: {{salary_utilities}}
• Other allowances: {{salary_allowances}}
• Gross monthly salary: {{salary_gross}}

This certificate is issued for {{purpose}} without any liability on the part of the company.

For {{company_name}}

_________________________
Authorized Signatory`,
  },
  {
    code: 'TPL-0007',
    name: 'No objection certificate (NOC)',
    letter_type: 'NOC',
    description: 'NOC for travel, visa, or external purpose',
    subject: 'No Objection Certificate — {{employee_name}}',
    body: `{{company_name}}
{{company_address}}

Date: {{date_today}}

NO OBJECTION CERTIFICATE

To Whom It May Concern,

This is to certify that {{employee_name}} (CNIC: {{cnic}}, Employee ID: {{employee_code}}) is employed with {{company_name}} as {{designation}} in {{department}} at {{branch}} since {{date_of_joining}}.

We have no objection to {{first_name}} {{purpose}}.

This NOC is issued on the employee's request and does not entitle any third party to claim employment benefits from {{company_name}}.

For {{company_name}}

_________________________
Authorized Signatory`,
  },
  {
    code: 'TPL-0008',
    name: 'Warning letter',
    letter_type: 'WARNING',
    description: 'Formal written warning for misconduct or performance',
    subject: 'Warning Letter — {{employee_name}}',
    body: `{{company_name}}
{{company_address}}

Date: {{date_today}}

To,
{{employee_name}} ({{employee_code}})
{{designation}}, {{department}}

Dear {{first_name}},

This letter serves as a formal written warning regarding: {{warning_reason}}

You are required to take immediate corrective action and comply with company policies, attendance standards, and your job responsibilities. Failure to improve may result in further disciplinary action up to and including termination.

Please acknowledge receipt of this letter by signing below.

Employee signature: _________________________   Date: ___________

For {{company_name}}

_________________________
Authorized Signatory`,
  },
  {
    code: 'TPL-0009',
    name: 'Termination letter',
    letter_type: 'TERMINATION',
    description: 'End of employment',
    subject: 'Termination of Employment — {{employee_name}}',
    body: `{{company_name}}
{{company_address}}

Date: {{date_today}}

To,
{{employee_name}} ({{employee_code}})
{{designation}}, {{department}}

Dear {{first_name}},

We regret to inform you that your employment with {{company_name}} is terminated with effect from {{date_today}}.

Reason: {{warning_reason}}

You are requested to return all company property, ID cards, and documents in your possession. Final settlement, if any, will be processed as per company policy and applicable law.

We wish you success in your future endeavours.

Yours sincerely,

_________________________
Authorized Signatory
{{company_name}}`,
  },
  {
    code: 'TPL-0010',
    name: 'Relieving letter',
    letter_type: 'RELIEVING',
    description: 'Issued on resignation / separation',
    subject: 'Relieving Letter — {{employee_name}}',
    body: `{{company_name}}
{{company_address}}

Date: {{date_today}}

To,
{{employee_name}} ({{employee_code}})

Dear {{first_name}},

This is to confirm that you have been relieved from your duties as {{designation}} in {{department}} at {{branch}} with effect from {{date_today}}, following your resignation / separation from {{company_name}}.

We acknowledge your services from {{date_of_joining}} until your last working day. You have cleared your dues and returned company assets to our satisfaction (subject to final payroll clearance).

We thank you for your contribution and wish you well.

Yours sincerely,

_________________________
Authorized Signatory
{{company_name}}`,
  },
  {
    code: 'TPL-0011',
    name: 'Transfer letter',
    letter_type: 'TRANSFER',
    description: 'Transfer to another branch or department',
    subject: 'Transfer Order — {{employee_name}}',
    body: `{{company_name}}
{{company_address}}

Date: {{date_today}}

To,
{{employee_name}} ({{employee_code}})
{{designation}}

Dear {{first_name}},

You are hereby transferred to {{branch}} / {{department}} with effect from {{date_today}}.

Your designation remains {{designation}} unless otherwise notified. Reporting structure and compensation will continue as per existing records unless revised in writing by HR.

Please report to the site / department head at the new location on the effective date.

Yours sincerely,

_________________________
Authorized Signatory
{{company_name}}`,
  },
  {
    code: 'TPL-0012',
    name: 'General HR letter',
    letter_type: 'GENERAL',
    description: 'Flexible template for any HR communication',
    subject: '{{purpose}} — {{employee_name}}',
    body: `{{company_name}}
{{company_address}}

Date: {{date_today}}

To,
{{employee_name}} ({{employee_code}})
{{designation}}, {{department}}
{{branch}}

Dear {{first_name}},

{{purpose}}

Please contact HR if you have any questions regarding this communication.

Yours sincerely,

_________________________
Authorized Signatory
{{company_name}}`,
  },
]
