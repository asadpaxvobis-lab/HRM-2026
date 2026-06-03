import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import { Toaster } from 'sonner'
import { ThemeProvider } from '@/contexts/ThemeContext'
import { AuthProvider } from '@/contexts/AuthContext'
import { AppShell } from '@/components/layout/AppShell'
import { ProtectedRoute } from '@/components/ProtectedRoute'
import { LoginPage } from '@/pages/Login'
import { ChangePasswordPage } from '@/pages/ChangePassword'
import { DashboardPage } from '@/pages/Dashboard'
import { UsersPage } from '@/pages/admin/Users'
import { RolesPage } from '@/pages/admin/Roles'
import { SettingsPage } from '@/pages/admin/Settings'
import { AuditLogPage } from '@/pages/admin/AuditLog'
import { BranchesPage } from '@/pages/master/Branches'
import { DepartmentsPage } from '@/pages/master/Departments'
import { DesignationsPage } from '@/pages/master/Designations'
import { EmployeesPage } from '@/pages/master/Employees'
import { EmployeeDetailPage } from '@/pages/master/EmployeeDetail'
import { HolidaysPage } from '@/pages/master/Holidays'
import { ShiftsPage } from '@/pages/master/Shifts'
import { RosterPage } from '@/pages/master/Roster'
import { AttendancePage } from '@/pages/attendance/Attendance'
import { LiveAttendancePage } from '@/pages/attendance/LiveAttendance'
import { LateEmployeesPage } from '@/pages/attendance/LateEmployees'
import { CorrectionsPage } from '@/pages/attendance/Corrections'
import { DevicesPage } from '@/pages/admin/Devices'
import { ProfilePage } from '@/pages/Profile'
import { LeavePage } from '@/pages/leave/Leave'
import { LeaveTypesPage } from '@/pages/leave/LeaveTypes'
import { LeaveBalancesPage } from '@/pages/leave/LeaveBalances'
import { PayrollPage } from '@/pages/payroll/Payroll'
import { PayrollComponentsPage } from '@/pages/payroll/Components'
import { TaxSlabsPage } from '@/pages/payroll/TaxSlabs'
import { PayrollPeriodDetailPage } from '@/pages/payroll/PayrollPeriodDetail'
import { PayslipDetailPage } from '@/pages/payroll/PayslipDetail'
import { ExpensesPage } from '@/pages/expenses/Expenses'
import { ExpenseDetailPage } from '@/pages/expenses/ExpenseDetail'
import { ExpenseCategoriesPage } from '@/pages/expenses/Categories'
import { LoansPage } from '@/pages/loans/Loans'
import { LoanTypesPage } from '@/pages/loans/LoanTypes'
import { LoanDetailPage } from '@/pages/loans/LoanDetail'
import { AnnouncementsPage } from '@/pages/announcements/Announcements'
import { AnnouncementDetailPage } from '@/pages/announcements/AnnouncementDetail'
import { OvertimePage } from '@/pages/overtime/Overtime'
import { OvertimeTakenPage } from '@/pages/overtime/OvertimeTaken'
import { OvertimeApprovalPage } from '@/pages/overtime/OvertimeApproval'
import { OvertimeEditTypePage } from '@/pages/overtime/OvertimeEditType'
import { LettersPage } from '@/pages/letters/Letters'
import { LetterTemplatesPage } from '@/pages/letters/Templates'
import { LetterDetailPage } from '@/pages/letters/LetterDetail'
import { ReportsHubPage } from '@/pages/reports/ReportsHub'
import { DirectoryReportPage } from '@/pages/reports/Directory'
import { MusterRollPage } from '@/pages/reports/MusterRoll'
import { SalaryRegisterPage } from '@/pages/reports/SalaryRegister'
import { BankDisbursementPage } from '@/pages/reports/BankDisbursement'
import { StatutoryReportPage } from '@/pages/reports/Statutory'
import { LeaveRegisterPage } from '@/pages/reports/LeaveRegister'
import { LoanOutstandingPage } from '@/pages/reports/LoanOutstanding'
import { OvertimeReportPage } from '@/pages/reports/OvertimeReport'
import { ResignationsPage } from '@/pages/resignations/Resignations'
import { ResignationDetailPage } from '@/pages/resignations/ResignationDetail'
import { RecruitmentHubPage } from '@/pages/recruitment/RecruitmentHub'
import { JobPostingsPage } from '@/pages/recruitment/JobPostings'
import { RecruitmentPipelinePage } from '@/pages/recruitment/Pipeline'
import { CandidateDetailPage } from '@/pages/recruitment/CandidateDetail'

export default function App() {
  return (
    <ThemeProvider>
      <AuthProvider>
        <BrowserRouter>
          <Routes>
            <Route path="/login" element={<LoginPage />} />
            <Route
              path="/change-password"
              element={
                <ProtectedRoute>
                  <ChangePasswordPage />
                </ProtectedRoute>
              }
            />

            <Route
              element={
                <ProtectedRoute>
                  <AppShell />
                </ProtectedRoute>
              }
            >
              <Route index element={<DashboardPage />} />

              {/* Admin section */}
              <Route
                path="admin/users"
                element={
                  <ProtectedRoute perm="user.view">
                    <UsersPage />
                  </ProtectedRoute>
                }
              />
              <Route
                path="admin/roles"
                element={
                  <ProtectedRoute perm="role.view">
                    <RolesPage />
                  </ProtectedRoute>
                }
              />
              <Route
                path="admin/settings"
                element={
                  <ProtectedRoute perm="settings.view">
                    <SettingsPage />
                  </ProtectedRoute>
                }
              />
              <Route
                path="admin/audit"
                element={
                  <ProtectedRoute perm="audit.view">
                    <AuditLogPage />
                  </ProtectedRoute>
                }
              />

              {/* Master data (Phase 2) */}
              <Route
                path="employees"
                element={
                  <ProtectedRoute perm="employee.view">
                    <EmployeesPage />
                  </ProtectedRoute>
                }
              />
              <Route
                path="departments"
                element={
                  <ProtectedRoute perm="department.view">
                    <DepartmentsPage />
                  </ProtectedRoute>
                }
              />
              <Route
                path="designations"
                element={
                  <ProtectedRoute perm="designation.view">
                    <DesignationsPage />
                  </ProtectedRoute>
                }
              />
              <Route
                path="branches"
                element={
                  <ProtectedRoute perm="branch.view">
                    <BranchesPage />
                  </ProtectedRoute>
                }
              />
              <Route
                path="employees/:id"
                element={
                  <ProtectedRoute perm="employee.view">
                    <EmployeeDetailPage />
                  </ProtectedRoute>
                }
              />
              <Route
                path="holidays"
                element={
                  <ProtectedRoute perm="holiday.view">
                    <HolidaysPage />
                  </ProtectedRoute>
                }
              />
              <Route
                path="shifts"
                element={
                  <ProtectedRoute perm="shift.view">
                    <ShiftsPage />
                  </ProtectedRoute>
                }
              />
              <Route
                path="roster"
                element={
                  <ProtectedRoute perm="shift.view">
                    <RosterPage />
                  </ProtectedRoute>
                }
              />
              <Route
                path="attendance/live"
                element={
                  <ProtectedRoute perm="attendance.view">
                    <LiveAttendancePage />
                  </ProtectedRoute>
                }
              />
              <Route
                path="attendance/late"
                element={
                  <ProtectedRoute perm="attendance.view">
                    <LateEmployeesPage />
                  </ProtectedRoute>
                }
              />
              <Route
                path="attendance"
                element={
                  <ProtectedRoute perm="attendance.view">
                    <AttendancePage />
                  </ProtectedRoute>
                }
              />
              <Route
                path="attendance/corrections"
                element={
                  <ProtectedRoute perm="attendance.view">
                    <CorrectionsPage />
                  </ProtectedRoute>
                }
              />
              <Route
                path="overtime/taken"
                element={
                  <ProtectedRoute perm="overtime.view">
                    <OvertimeTakenPage />
                  </ProtectedRoute>
                }
              />
              <Route
                path="overtime/approval"
                element={
                  <ProtectedRoute perm="overtime.view">
                    <OvertimeApprovalPage />
                  </ProtectedRoute>
                }
              />
              <Route
                path="overtime/edit-type"
                element={
                  <ProtectedRoute perm="overtime.approve">
                    <OvertimeEditTypePage />
                  </ProtectedRoute>
                }
              />
              <Route
                path="overtime"
                element={
                  <ProtectedRoute perm="overtime.view">
                    <OvertimePage />
                  </ProtectedRoute>
                }
              />
              <Route
                path="admin/devices"
                element={
                  <ProtectedRoute perm="attendance.view">
                    <DevicesPage />
                  </ProtectedRoute>
                }
              />
              <Route
                path="leave"
                element={
                  <ProtectedRoute perm="leave.view">
                    <LeavePage />
                  </ProtectedRoute>
                }
              />
              <Route
                path="leave/types"
                element={
                  <ProtectedRoute perm="leave.config">
                    <LeaveTypesPage />
                  </ProtectedRoute>
                }
              />
              <Route
                path="leave/balances"
                element={
                  <ProtectedRoute perm="leave.view">
                    <LeaveBalancesPage />
                  </ProtectedRoute>
                }
              />
              <Route
                path="payroll"
                element={
                  <ProtectedRoute perm="payroll.view">
                    <PayrollPage />
                  </ProtectedRoute>
                }
              />
              <Route
                path="payroll/components"
                element={
                  <ProtectedRoute perm="payroll.config">
                    <PayrollComponentsPage />
                  </ProtectedRoute>
                }
              />
              <Route
                path="payroll/tax-slabs"
                element={
                  <ProtectedRoute perm="payroll.view">
                    <TaxSlabsPage />
                  </ProtectedRoute>
                }
              />
              <Route
                path="payroll/:id"
                element={
                  <ProtectedRoute perm="payroll.view">
                    <PayrollPeriodDetailPage />
                  </ProtectedRoute>
                }
              />
              <Route
                path="payroll/payslip/:id"
                element={
                  <ProtectedRoute perm="payroll.view">
                    <PayslipDetailPage />
                  </ProtectedRoute>
                }
              />
              <Route
                path="expenses"
                element={
                  <ProtectedRoute perm="expense.view">
                    <ExpensesPage />
                  </ProtectedRoute>
                }
              />
              <Route
                path="expenses/categories"
                element={
                  <ProtectedRoute perm="expense.config">
                    <ExpenseCategoriesPage />
                  </ProtectedRoute>
                }
              />
              <Route
                path="expenses/:id"
                element={
                  <ProtectedRoute perm="expense.view">
                    <ExpenseDetailPage />
                  </ProtectedRoute>
                }
              />

              {/* Loans (Phase 7) */}
              <Route
                path="loans"
                element={
                  <ProtectedRoute perm="loan.view">
                    <LoansPage />
                  </ProtectedRoute>
                }
              />
              <Route
                path="loans/types"
                element={
                  <ProtectedRoute perm="loan.approve">
                    <LoanTypesPage />
                  </ProtectedRoute>
                }
              />
              <Route
                path="loans/:id"
                element={
                  <ProtectedRoute perm="loan.view">
                    <LoanDetailPage />
                  </ProtectedRoute>
                }
              />

              <Route
                path="announcements"
                element={
                  <ProtectedRoute perm="announcement.view">
                    <AnnouncementsPage />
                  </ProtectedRoute>
                }
              />
              <Route
                path="announcements/:id"
                element={
                  <ProtectedRoute perm="announcement.view">
                    <AnnouncementDetailPage />
                  </ProtectedRoute>
                }
              />
              <Route
                path="letters"
                element={
                  <ProtectedRoute perm="letter.view">
                    <LettersPage />
                  </ProtectedRoute>
                }
              />
              <Route
                path="letters/templates"
                element={
                  <ProtectedRoute perm="letter.template">
                    <LetterTemplatesPage />
                  </ProtectedRoute>
                }
              />
              <Route
                path="letters/:id"
                element={
                  <ProtectedRoute perm="letter.view">
                    <LetterDetailPage />
                  </ProtectedRoute>
                }
              />
              <Route
                path="reports"
                element={
                  <ProtectedRoute perm="report.view">
                    <ReportsHubPage />
                  </ProtectedRoute>
                }
              />
              <Route
                path="reports/directory"
                element={
                  <ProtectedRoute perm="employee.view">
                    <DirectoryReportPage />
                  </ProtectedRoute>
                }
              />
              <Route
                path="reports/muster"
                element={
                  <ProtectedRoute perm="attendance.view">
                    <MusterRollPage />
                  </ProtectedRoute>
                }
              />
              <Route
                path="reports/salary-register"
                element={
                  <ProtectedRoute perm="payroll.view">
                    <SalaryRegisterPage />
                  </ProtectedRoute>
                }
              />
              <Route
                path="reports/bank-disbursement"
                element={
                  <ProtectedRoute perm="payroll.view">
                    <BankDisbursementPage />
                  </ProtectedRoute>
                }
              />
              <Route
                path="reports/statutory"
                element={
                  <ProtectedRoute perm="payroll.view">
                    <StatutoryReportPage />
                  </ProtectedRoute>
                }
              />
              <Route
                path="reports/leave"
                element={
                  <ProtectedRoute perm="leave.view">
                    <LeaveRegisterPage />
                  </ProtectedRoute>
                }
              />
              <Route
                path="reports/loans"
                element={
                  <ProtectedRoute perm="loan.view">
                    <LoanOutstandingPage />
                  </ProtectedRoute>
                }
              />
              <Route
                path="reports/overtime"
                element={
                  <ProtectedRoute perm="overtime.view">
                    <OvertimeReportPage />
                  </ProtectedRoute>
                }
              />

              <Route
                path="resignations"
                element={
                  <ProtectedRoute perm="resignation.view">
                    <ResignationsPage />
                  </ProtectedRoute>
                }
              />
              <Route
                path="resignations/:id"
                element={
                  <ProtectedRoute perm="resignation.view">
                    <ResignationDetailPage />
                  </ProtectedRoute>
                }
              />

              <Route
                path="recruitment"
                element={
                  <ProtectedRoute perm="recruitment.view">
                    <RecruitmentHubPage />
                  </ProtectedRoute>
                }
              />
              <Route
                path="recruitment/jobs"
                element={
                  <ProtectedRoute perm="recruitment.view">
                    <JobPostingsPage />
                  </ProtectedRoute>
                }
              />
              <Route
                path="recruitment/pipeline"
                element={
                  <ProtectedRoute perm="recruitment.view">
                    <RecruitmentPipelinePage />
                  </ProtectedRoute>
                }
              />
              <Route
                path="recruitment/candidates/:id"
                element={
                  <ProtectedRoute perm="recruitment.view">
                    <CandidateDetailPage />
                  </ProtectedRoute>
                }
              />

              <Route path="profile" element={<ProfilePage />} />
            </Route>

            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </BrowserRouter>
        <Toaster richColors position="top-right" closeButton />
      </AuthProvider>
    </ThemeProvider>
  )
}
