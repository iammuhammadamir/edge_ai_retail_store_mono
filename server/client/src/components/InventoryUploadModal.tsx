import { useState, useRef } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Loader2, Plus, Trash2, Save, Upload, AlertTriangle, CheckCircle } from "lucide-react";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

interface AnalyzedItem {
    itemName: string;
    quantity: number;
    category: string;
    confidence: number;
    warnings?: string[];
}

interface InventoryUploadModalProps {
    locationId: number;
}

export function InventoryUploadModal({ locationId }: InventoryUploadModalProps) {
    const [open, setOpen] = useState(false);
    const [images, setImages] = useState<string[]>([]);
    const [results, setResults] = useState<AnalyzedItem[]>([]);
    const [step, setStep] = useState<"upload" | "review">("upload");
    const fileInputRef = useRef<HTMLInputElement>(null);
    const { toast } = useToast();
    const queryClient = useQueryClient();

    // Convert file to base64
    const toBase64 = (file: File) => new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.readAsDataURL(file);
        reader.onload = () => resolve(reader.result as string);
        reader.onerror = error => reject(error);
    });

    const handleFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
        if (e.target.files && e.target.files.length > 0) {
            const newFiles = Array.from(e.target.files);

            // Basic validation
            const validFiles = newFiles.filter(file => file.type.startsWith('image/'));
            if (validFiles.length !== newFiles.length) {
                toast({
                    title: "Invalid files",
                    description: "Some files were skipped because they are not images.",
                    variant: "destructive"
                });
            }

            const base64Files = await Promise.all(validFiles.map(toBase64));
            setImages(prev => [...prev, ...base64Files]);

            // Check total payload size approx
            const totalSize = base64Files.reduce((acc, curr) => acc + curr.length, 0);
            if (totalSize > 45 * 1024 * 1024) { // 45MB roughly
                toast({
                    title: "Warning: Upload Size",
                    description: "Total image size is large. Analysis might take longer.",
                    variant: "default"
                });
            }
        }
    };

    const removeImage = (index: number) => {
        setImages(prev => prev.filter((_, i) => i !== index));
    };

    const analyzeMutation = useMutation({
        mutationFn: async (images: string[]) => {
            const res = await apiRequest("/api/inventory/analyze", {
                method: "POST",
                body: JSON.stringify({ images }),
            });
            return res;
        },
        onSuccess: (data: any) => {
            // Handle both array and object response formats
            const items = Array.isArray(data) ? data : (data.items || []);
            setResults(items);
            setStep("review");

            if (items.length === 0) {
                toast({
                    title: "No items found",
                    description: "The AI couldn't identify any inventory items in the images.",
                });
            }
        },
        onError: (error: any) => {
            toast({
                title: "Analysis Failed",
                description: error.message,
                variant: "destructive",
            });
        },
    });

    const saveMutation = useMutation({
        mutationFn: async (item: AnalyzedItem) => {
            // Create batch number based on date
            const batchNumber = `AUTO-${new Date().toISOString().slice(0, 10).replace(/-/g, "")}`;
            // Set expiration to 1 year from now by default
            const expirationDate = new Date();
            expirationDate.setFullYear(expirationDate.getFullYear() + 1);

            return apiRequest("/api/inventory", {
                method: "POST",
                body: JSON.stringify({
                    itemName: item.itemName,
                    quantity: item.quantity,
                    category: item.category,
                    batchNumber,
                    expirationDate: expirationDate.toISOString(),
                    locationId,
                }),
            });
        },
    });

    const handleSaveAll = async () => {
        try {
            let savedCount = 0;
            // Execute sequentially to avoid overwhelming server
            for (const item of results) {
                await saveMutation.mutateAsync(item);
                savedCount++;
            }

            toast({
                title: "Success",
                description: `Successfully added ${savedCount} items to inventory.`,
            });

            queryClient.invalidateQueries({ queryKey: ["/api/inventory"] });
            setOpen(false);
            resetState();
        } catch (error) {
            toast({
                title: "Save Incomplete",
                description: "Failed to save some items. Please try again.",
                variant: "destructive",
            });
        }
    };

    const resetState = () => {
        setImages([]);
        setResults([]);
        setStep("upload");
    };

    const updateResult = (index: number, field: keyof AnalyzedItem, value: any) => {
        const newResults = [...results];
        newResults[index] = { ...newResults[index], [field]: value };
        setResults(newResults);
    };

    return (
        <Dialog open={open} onOpenChange={(val) => {
            setOpen(val);
            if (!val) resetState();
        }}>
            <DialogTrigger asChild>
                <Button className="gap-2 shadow-sm">
                    <Upload className="h-4 w-4" />
                    Scan Images
                </Button>
            </DialogTrigger>
            <DialogContent className="max-w-5xl h-[85vh] flex flex-col p-0 gap-0 overflow-hidden sm:rounded-xl bg-white border-slate-200 shadow-xl">
                <DialogHeader className="px-6 py-4 border-b border-slate-100 bg-slate-50/80 shrink-0">
                    <DialogTitle className="text-xl flex items-center gap-2">
                        {step === 'upload' ? <Upload className="h-5 w-5 text-primary" /> : <CheckCircle className="h-5 w-5 text-green-600" />}
                        {step === 'upload' ? 'Upload Inventory Photos' : 'Review & Save Inventory'}
                    </DialogTitle>
                    <DialogDescription>
                        {step === 'upload'
                            ? 'Upload photos of shelves or products. The AI will count and identify items automatically.'
                            : 'Review the identified items below. You can edit names, quantities, and categories before saving.'}
                    </DialogDescription>
                </DialogHeader>

                <div className="flex-1 overflow-y-auto bg-background p-6">
                    {step === "upload" && (
                        <div className="space-y-8 max-w-3xl mx-auto">
                            <div
                                className={cn(
                                    "border-2 border-dashed rounded-xl p-16 text-center cursor-pointer transition-all duration-200",
                                    "hover:bg-muted/50 hover:border-primary/50",
                                    "flex flex-col items-center justify-center gap-4",
                                    images.length === 0 ? "border-muted-foreground/25" : "border-primary/20 bg-muted/10"
                                )}
                                onClick={() => fileInputRef.current?.click()}
                            >
                                <Input
                                    type="file"
                                    multiple
                                    accept="image/*"
                                    className="hidden"
                                    ref={fileInputRef}
                                    onChange={handleFileSelect}
                                />
                                <div className="p-4 rounded-full bg-primary/5">
                                    <Upload className="h-10 w-10 text-primary" />
                                </div>
                                <div className="space-y-1">
                                    <p className="text-lg font-semibold text-foreground">
                                        Click to upload images
                                    </p>
                                    <p className="text-sm text-muted-foreground">
                                        Support for JPG, PNG (Max 50MB total)
                                    </p>
                                </div>
                            </div>

                            {images.length > 0 && (
                                <div className="space-y-3">
                                    <div className="flex items-center justify-between">
                                        <h3 className="text-sm font-medium text-muted-foreground">Selected Images ({images.length})</h3>
                                        <Button variant="ghost" size="sm" onClick={() => setImages([])} className="text-destructive hover:text-destructive">
                                            Clear All
                                        </Button>
                                    </div>
                                    <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-4">
                                        {images.map((img, idx) => (
                                            <div key={idx} className="relative group aspect-square rounded-lg overflow-hidden border bg-muted shadow-sm">
                                                <img src={img} alt={`Upload preview ${idx + 1}`} className="object-cover w-full h-full" />
                                                <div className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">
                                                    <Button
                                                        variant="destructive"
                                                        size="icon"
                                                        className="h-8 w-8 rounded-full"
                                                        onClick={(e) => {
                                                            e.stopPropagation();
                                                            removeImage(idx);
                                                        }}
                                                    >
                                                        <Trash2 className="h-4 w-4" />
                                                    </Button>
                                                </div>
                                            </div>
                                        ))}
                                        <div
                                            className="aspect-square rounded-lg border border-dashed border-muted-foreground/30 flex items-center justify-center hover:bg-muted/50 cursor-pointer transition-colors"
                                            onClick={() => fileInputRef.current?.click()}
                                        >
                                            <div className="text-center">
                                                <Plus className="h-6 w-6 mx-auto text-muted-foreground mb-1" />
                                                <span className="text-xs text-muted-foreground">Add more</span>
                                            </div>
                                        </div>
                                    </div>
                                </div>
                            )}
                        </div>
                    )}

                    {step === "review" && (
                        <div className="border rounded-lg overflow-hidden shadow-sm">
                            <Table>
                                <TableHeader className="bg-muted/40">
                                    <TableRow>
                                        <TableHead className="w-[30%]">Item Name</TableHead>
                                        <TableHead className="w-[15%]">Quantity</TableHead>
                                        <TableHead className="w-[20%]">Category</TableHead>
                                        <TableHead className="w-[15%]">Confidence</TableHead>
                                        <TableHead className="w-[10%] text-right"></TableHead>
                                    </TableRow>
                                </TableHeader>
                                <TableBody>
                                    {results.map((item, idx) => (
                                        <TableRow key={idx} className="hover:bg-muted/30">
                                            <TableCell className="align-top py-4">
                                                <div className="space-y-2">
                                                    <Input
                                                        value={item.itemName}
                                                        onChange={(e) => updateResult(idx, "itemName", e.target.value)}
                                                        className="font-medium"
                                                        placeholder="Product Name"
                                                    />
                                                    {item.warnings && item.warnings.length > 0 && (
                                                        <div className="flex flex-wrap gap-1.5">
                                                            {item.warnings.map((w, i) => (
                                                                <Badge key={i} variant="outline" className="text-[10px] px-1.5 py-0 h-5 border-yellow-200 bg-yellow-50 text-yellow-700 flex items-center gap-1">
                                                                    <AlertTriangle className="h-2.5 w-2.5" />
                                                                    {w}
                                                                </Badge>
                                                            ))}
                                                        </div>
                                                    )}
                                                </div>
                                            </TableCell>
                                            <TableCell className="align-top py-4">
                                                <Input
                                                    type="number"
                                                    min="0"
                                                    value={item.quantity}
                                                    onChange={(e) => updateResult(idx, "quantity", parseInt(e.target.value) || 0)}
                                                    className="w-24"
                                                />
                                            </TableCell>
                                            <TableCell className="align-top py-4">
                                                <Input
                                                    value={item.category}
                                                    onChange={(e) => updateResult(idx, "category", e.target.value)}
                                                    placeholder="Category"
                                                />
                                            </TableCell>
                                            <TableCell className="align-top py-4">
                                                <div className="flex items-center gap-2 mt-2">
                                                    <div className="h-2 w-16 bg-muted rounded-full overflow-hidden">
                                                        <div
                                                            className={cn("h-full rounded-full", item.confidence > 0.8 ? "bg-green-500" : item.confidence > 0.5 ? "bg-yellow-500" : "bg-red-500")}
                                                            style={{ width: `${item.confidence * 100}%` }}
                                                        />
                                                    </div>
                                                    <span className="text-xs text-muted-foreground font-medium">
                                                        {Math.round(item.confidence * 100)}%
                                                    </span>
                                                </div>
                                            </TableCell>
                                            <TableCell className="align-top py-4 text-right">
                                                <Button
                                                    variant="ghost"
                                                    size="icon"
                                                    className="h-9 w-9 text-muted-foreground hover:text-destructive hover:bg-destructive/10"
                                                    onClick={() => {
                                                        const newResults = results.filter((_, i) => i !== idx);
                                                        setResults(newResults);
                                                    }}
                                                >
                                                    <Trash2 className="h-4 w-4" />
                                                </Button>
                                            </TableCell>
                                        </TableRow>
                                    ))}
                                    {results.length === 0 && (
                                        <TableRow>
                                            <TableCell colSpan={5} className="h-32 text-center text-muted-foreground">
                                                No items to display.
                                            </TableCell>
                                        </TableRow>
                                    )}
                                </TableBody>
                            </Table>
                        </div>
                    )}
                </div>

                <div className="p-6 border-t bg-muted/10 shrink-0 flex items-center justify-between">
                    {step === "upload" ? (
                        <>
                            <Button variant="ghost" onClick={() => setOpen(false)}>Cancel</Button>
                            <Button
                                onClick={() => analyzeMutation.mutate(images)}
                                disabled={images.length === 0 || analyzeMutation.isPending}
                                className="min-w-[140px]"
                            >
                                {analyzeMutation.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                                {analyzeMutation.isPending ? 'Analyzing...' : `Analyze ${images.length > 0 ? images.length : ''} Images`}
                            </Button>
                        </>
                    ) : (
                        <>
                            <Button variant="outline" onClick={() => setStep("upload")} className="gap-2">
                                <Plus className="h-4 w-4" />
                                Scan More
                            </Button>
                            <div className="flex gap-2">
                                <Button variant="ghost" onClick={() => setOpen(false)}>Cancel</Button>
                                <Button
                                    onClick={handleSaveAll}
                                    disabled={saveMutation.isPending || results.length === 0}
                                    className="min-w-[140px]"
                                >
                                    {saveMutation.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                                    <Save className="mr-2 h-4 w-4" />
                                    Save Inventory
                                </Button>
                            </div>
                        </>
                    )}
                </div>
            </DialogContent>
        </Dialog>
    );
}
