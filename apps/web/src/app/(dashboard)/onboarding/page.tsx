import { OnboardingWizard } from '@/components/onboarding/OnboardingWizard'

export const dynamic = 'force-dynamic'

export default function OnboardingPage() {
  return (
    <div className="min-h-full flex flex-col items-center justify-center py-8">
      <div className="mb-8 text-center">
        <h1 className="text-2xl font-bold text-white mb-2">Get Started with SessionForge</h1>
        <p className="text-gray-400 text-sm">
          Set up your workspace in just a few minutes
        </p>
      </div>
      <OnboardingWizard />
    </div>
  )
}
