import PageWrapper from "@/components/page-wrapper";
import CreateCompititionForm from "@/modules/competitions/components/create-compitition-form";


export default function CreateCompititionPage() {
    return (
        <PageWrapper >
            <div className="space-y-2">
                <h1 className="text-3xl font-bold tracking-tight">
                    Create Competition
                </h1>

                <p className="text-muted-foreground">
                    Add a new competition to the Kizunia platform.
                </p>
            </div>

            <CreateCompititionForm/>
        </PageWrapper>
    );
}